//we will run this script with runAndWatch

import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { defaultBundler } from '../bundler.js';

const TEMP_DIR = path.join(process.cwd(), 'node_modules', '.temp');
const CACHE_FILE = '__cachedSubdependencies.js';

const HOT_BUNDLE_STATE_KEY = '__tinybuildHotBundleState';
const HOT_BUNDLE_STATE = globalThis[HOT_BUNDLE_STATE_KEY] ??= {
    queues: new Map(),
    activeBuilds: new Map()
};

const DEFAULT_HOTSWAP_QUEUE_OPTIONS = {
    singleChangeDelayMs: 650,
    bulkChangeDelayMs: 1200,
    bulkChangeThreshold: 2,
    fileSettleWindowMs: 350,
    fileSettlePollMs: 80,
    fileSettleTimeoutMs: 7000,
    dedupeAfterBuildMs: 1800,
    ignoreGeneratedHotFiles: true,
    logDelays: true
};

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function mergeOptions(bundlerConfig, overrideOptions = {}) {
    return {
        ...DEFAULT_HOTSWAP_QUEUE_OPTIONS,
        ...(bundlerConfig.hotSwap ?? {}),
        ...(bundlerConfig.hotswap ?? {}),
        ...(bundlerConfig.hotReload ?? {}),
        ...overrideOptions
    };
}

function normalizeChangedFiles(changed) {
    const files = [];

    const add = (value) => {
        if (!value) return;

        if (typeof value === 'string') {
            files.push(path.normalize(value));
            return;
        }

        if (Array.isArray(value)) {
            value.forEach(add);
            return;
        }

        if (value instanceof Set) {
            value.forEach(add);
            return;
        }

        if (typeof value === 'object') {
            add(value.path ?? value.file ?? value.filename ?? value.name);
        }
    };

    add(changed);

    return [...new Set(files)];
}

function toAbsolutePath(filePath) {
    if (!filePath) return '';
    return path.isAbsolute(filePath)
        ? path.normalize(filePath)
        : path.resolve(process.cwd(), filePath);
}

function pathKey(filePath) {
    const absolutePath = toAbsolutePath(filePath);
    return process.platform === 'win32'
        ? absolutePath.toLowerCase()
        : absolutePath;
}

function isInsideDir(filePath, dirPath) {
    const absoluteFile = toAbsolutePath(filePath);
    const absoluteDir = toAbsolutePath(dirPath);
    const relative = path.relative(absoluteDir, absoluteFile);
    return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function describeChangedFiles(files) {
    const names = [...files]
        .map(filePath => path.basename(filePath))
        .filter(Boolean);

    if (names.length === 0) return '';
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]}, ${names[1]}`;
    return `${names[0]} + ${names.length - 1} files`;
}

function queueDelayFor(changeCount, options) {
    return changeCount >= options.bulkChangeThreshold
        ? options.bulkChangeDelayMs
        : options.singleChangeDelayMs;
}

function getOutdir(bundlerConfig) {
    if (bundlerConfig.outdir) return bundlerConfig.outdir;

    const sourcePath = bundlerConfig.outfile ?? bundlerConfig.entryPoints?.[0];
    if (!sourcePath) return 'dist';

    const split = sourcePath.split('/');
    split.pop();

    return split.length === 0 || split.join('/') === ''
        ? 'dist'
        : split.join('/');
}

function getOutfile(bundlerConfig) {
    const sourcePath = bundlerConfig.outfile ?? bundlerConfig.entryPoints?.[0] ?? 'index.js';
    return sourcePath.split('/').pop();
}

function getCssOutfile(bundlerConfig) {
    const outfile = getOutfile(bundlerConfig);
    return outfile.endsWith('.js')
        ? outfile.replace(/\.js$/i, '.css')
        : `${outfile}.css`;
}

function getOutputCssPath(bundlerConfig) {
    return path.join(getOutdir(bundlerConfig), getCssOutfile(bundlerConfig));
}

function getGeneratedHotPaths(bundlerConfig) {
    const outfile = getOutfile(bundlerConfig);
    const tempJs = path.join(TEMP_DIR, outfile.endsWith('.js') ? outfile : `${outfile}.js`);
    const tempCss = tempJs.replace(/\.js$/i, '.css');
    const outCss = getOutputCssPath(bundlerConfig);
    const cacheFile = path.join(TEMP_DIR, CACHE_FILE);

    return new Set([
        pathKey(tempJs),
        pathKey(tempCss),
        pathKey(outCss),
        pathKey(cacheFile)
    ]);
}

function shouldIgnoreChangedFile(filePath, bundlerConfig, options) {
    if (!options.ignoreGeneratedHotFiles || !filePath) return false;

    const key = pathKey(filePath);
    if (getGeneratedHotPaths(bundlerConfig).has(key)) return true;
    if (isInsideDir(filePath, TEMP_DIR)) return true;

    return false;
}

function getHotBundleQueueKey(bundlerConfig) {
    const targetCss = pathKey(getOutputCssPath(bundlerConfig));
    return `${process.cwd()}::${targetCss}`;
}

function fileSnapshotSignature(snapshot) {
    if (!snapshot) return 'ignored';
    if (snapshot.exists) return `file:${snapshot.size}:${Math.round(snapshot.mtimeMs)}`;
    return `missing:${snapshot.code ?? 'UNKNOWN'}:${snapshot.busy ? 'busy' : 'gone'}`;
}

async function snapshotReadableFile(filePath) {
    const absolutePath = toAbsolutePath(filePath);
    let handle;

    try {
        const stat = await fs.promises.stat(absolutePath);
        if (!stat.isFile()) return null;

        handle = await fs.promises.open(absolutePath, 'r');
        return {
            exists: true,
            size: stat.size,
            mtimeMs: stat.mtimeMs
        };
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return { exists: false, code: error.code };
        }

        return {
            exists: false,
            busy: true,
            code: error?.code ?? 'UNKNOWN'
        };
    } finally {
        if (handle) {
            await handle.close().catch(() => {});
        }
    }
}

async function waitForChangedFilesToSettle(changedFiles, options) {
    const files = [...changedFiles].filter(Boolean);
    if (files.length === 0) return;

    const start = Date.now();
    const snapshots = new Map();
    let stableSince = 0;

    while (true) {
        const now = Date.now();
        let changed = false;
        let busy = false;

        for (const filePath of files) {
            const snapshot = await snapshotReadableFile(filePath);
            if (snapshot === null) continue;

            const key = fileSnapshotSignature(snapshot);
            if (snapshot.busy) busy = true;
            if (snapshots.get(filePath) !== key) changed = true;
            snapshots.set(filePath, key);
        }

        if (changed || busy) {
            stableSince = 0;
        } else {
            stableSince ||= now;
            if (now - stableSince >= options.fileSettleWindowMs) {
                return;
            }
        }

        if (now - start >= options.fileSettleTimeoutMs) {
            console.warn(`🔥 Proceeding after waiting ${options.fileSettleTimeoutMs}ms for changed files to settle`);
            return;
        }

        await sleep(options.fileSettlePollMs);
    }
}

async function captureFileSignatures(files) {
    const signatures = new Map();

    for (const filePath of files) {
        if (!filePath) continue;
        const snapshot = await snapshotReadableFile(filePath);
        if (snapshot === null) continue;
        signatures.set(pathKey(filePath), fileSnapshotSignature(snapshot));
    }

    return signatures;
}

function signaturesMatch(files, previousSignatures, currentSignatures) {
    if (files.size === 0) return false;

    for (const filePath of files) {
        const key = pathKey(filePath);
        if (!previousSignatures.has(key)) return false;
        if (previousSignatures.get(key) !== currentSignatures.get(key)) return false;
    }

    return true;
}

async function runSingleFlightBuild(queueKey, bundlerConfig, changedLabel) {
    const activeBuild = HOT_BUNDLE_STATE.activeBuilds.get(queueKey);
    if (activeBuild) {
        return activeBuild;
    }

    const buildPromise = hotBundleNow(bundlerConfig, changedLabel)
        .finally(() => {
            if (HOT_BUNDLE_STATE.activeBuilds.get(queueKey) === buildPromise) {
                HOT_BUNDLE_STATE.activeBuilds.delete(queueKey);
            }
        });

    HOT_BUNDLE_STATE.activeBuilds.set(queueKey, buildPromise);
    return buildPromise;
}

class HotBundleQueue {
    constructor(queueKey, bundlerConfig, options) {
        this.queueKey = queueKey;
        this.bundlerConfig = bundlerConfig;
        this.options = options;
        this.pendingChangedFiles = new Set();
        this.pendingWaiters = [];
        this.timer = null;
        this.running = false;
        this.lastBuildFinishedAt = 0;
        this.lastBuiltFileSignatures = new Map();
    }

    async request(changed = '', overrideOptions = {}) {
        this.options = mergeOptions(this.bundlerConfig, overrideOptions);

        const rawChangedFiles = normalizeChangedFiles(changed);
        const changedFiles = rawChangedFiles.filter(filePath => !shouldIgnoreChangedFile(filePath, this.bundlerConfig, this.options));

        if (rawChangedFiles.length > 0 && changedFiles.length === 0) {
            return { skipped: true, reason: 'generated-hot-file' };
        }

        if (await this.shouldSkipRecentDuplicate(changedFiles)) {
            const changedLabel = describeChangedFiles(changedFiles);
            if (this.options.logDelays && changedLabel) {
                console.log(`🔥 Skipping duplicate hotswap event for ${changedLabel}`);
            }
            return { skipped: true, reason: 'duplicate-watch-event', changed: changedLabel };
        }

        for (const filePath of changedFiles) {
            this.pendingChangedFiles.add(filePath);
        }

        const promise = new Promise((resolve, reject) => {
            this.pendingWaiters.push({ resolve, reject });
        });

        if (!this.running) {
            this.schedule();
        }

        return promise;
    }

    async shouldSkipRecentDuplicate(changedFiles) {
        if (changedFiles.length === 0) return false;
        if (this.running || this.timer || this.pendingChangedFiles.size > 0 || this.pendingWaiters.length > 0) return false;
        if (!this.lastBuildFinishedAt) return false;
        if (Date.now() - this.lastBuildFinishedAt > this.options.dedupeAfterBuildMs) return false;

        const currentSignatures = await captureFileSignatures(changedFiles);
        return signaturesMatch(new Set(changedFiles), this.lastBuiltFileSignatures, currentSignatures);
    }

    async shouldSkipSettledDuplicate(changedFiles, currentSignatures) {
        if (changedFiles.size === 0) return false;
        if (!this.lastBuildFinishedAt) return false;
        if (Date.now() - this.lastBuildFinishedAt > this.options.dedupeAfterBuildMs) return false;

        return signaturesMatch(changedFiles, this.lastBuiltFileSignatures, currentSignatures);
    }

    schedule() {
        if (this.timer) clearTimeout(this.timer);

        const delay = queueDelayFor(this.pendingChangedFiles.size, this.options);
        if (this.options.logDelays && this.pendingChangedFiles.size >= this.options.bulkChangeThreshold) {
            console.log(`🔥 Bulk change detected, waiting ${delay}ms for the file set to quiet`);
        }

        this.timer = setTimeout(() => {
            this.timer = null;
            this.flush().catch(error => {
                console.error(error);
            });
        }, delay);
    }

    drainChangedFiles() {
        const changedFiles = new Set(this.pendingChangedFiles);
        this.pendingChangedFiles.clear();
        return changedFiles;
    }

    drainWaiters() {
        const waiters = this.pendingWaiters;
        this.pendingWaiters = [];
        return waiters;
    }

    addCacheFileIfPresent(settleFiles) {
        const cacheFile = path.join(TEMP_DIR, CACHE_FILE);
        if (fs.existsSync(cacheFile)) {
            settleFiles.add(cacheFile);
        }
    }

    async absorbQuietChanges(settleFiles, displayFiles, waiters) {
        while (true) {
            await waitForChangedFilesToSettle(settleFiles, this.options);

            if (this.pendingChangedFiles.size === 0) return;

            const incomingFiles = this.drainChangedFiles();
            for (const filePath of incomingFiles) {
                settleFiles.add(filePath);
                displayFiles.add(filePath);
            }
            this.addCacheFileIfPresent(settleFiles);
            waiters.push(...this.drainWaiters());

            const delay = queueDelayFor(incomingFiles.size, this.options);
            if (this.options.logDelays) {
                console.log(`🔥 More changes arrived while files were settling, waiting ${delay}ms again`);
            }
            await sleep(delay);
        }
    }

    resolveWaiters(waiters, value) {
        for (const waiter of waiters) {
            waiter.resolve(value);
        }
    }

    rejectWaiters(waiters, error) {
        for (const waiter of waiters) {
            waiter.reject(error);
        }
    }

    async flush() {
        if (this.running) return;

        this.running = true;

        const displayFiles = this.drainChangedFiles();
        const settleFiles = new Set(displayFiles);
        const waiters = this.drainWaiters();
        this.addCacheFileIfPresent(settleFiles);

        try {
            await this.absorbQuietChanges(settleFiles, displayFiles, waiters);

            const changedLabel = describeChangedFiles(displayFiles);
            const buildFileSignatures = await captureFileSignatures(displayFiles);

            if (await this.shouldSkipSettledDuplicate(displayFiles, buildFileSignatures)) {
                if (this.options.logDelays && changedLabel) {
                    console.log(`🔥 Skipping duplicate settled hotswap for ${changedLabel}`);
                }
                this.resolveWaiters(waiters, { skipped: true, reason: 'duplicate-settled-watch-event', changed: changedLabel });
                return;
            }

            const result = await runSingleFlightBuild(this.queueKey, this.bundlerConfig, changedLabel);

            this.lastBuildFinishedAt = Date.now();
            this.lastBuiltFileSignatures = buildFileSignatures;
            this.resolveWaiters(waiters, result);
        } catch (error) {
            this.rejectWaiters(waiters, error);
            throw error;
        } finally {
            this.running = false;

            if (this.pendingWaiters.length > 0 || this.pendingChangedFiles.size > 0) {
                this.schedule();
            }
        }
    }
}

function getHotBundleQueue(bundlerConfig, options) {
    const key = getHotBundleQueueKey(bundlerConfig);
    let queue = HOT_BUNDLE_STATE.queues.get(key);

    if (!queue) {
        queue = new HotBundleQueue(key, bundlerConfig, options);
        HOT_BUNDLE_STATE.queues.set(key, queue);
    } else {
        queue.queueKey = key;
        queue.bundlerConfig = bundlerConfig;
        queue.options = options;
    }

    return queue;
}

async function hotBundleNow(
    bundlerConfig = defaultBundler,
    changed = ''
) {
    const timerLabel = `🔥 Hotswapped${changed ? ' ' + changed : ''} 🔥`;
    console.time(timerLabel);

    const outdir = getOutdir(bundlerConfig);
    const outfile = getOutfile(bundlerConfig);

    const cacheFile = path.join(TEMP_DIR, CACHE_FILE);
    if (!fs.existsSync(cacheFile)) {
        console.warn(`🔥 No CSS cache found at ${cacheFile}, skipping hotBundle`);
        console.timeEnd(timerLabel);
        return { skipped: true, reason: 'missing-css-cache' };
    }

    let result = 'node_modules/.temp/' + outfile;
    if (!result.endsWith('.js')) result += '.js';

    await esbuild.build({
        entryPoints: ['node_modules/.temp/__cachedSubdependencies.js'],
        outfile: result,
        bundle: true,
        allowOverwrite: true,
        plugins: bundlerConfig.plugins ? bundlerConfig.plugins : [],
        loader: bundlerConfig.loader ? bundlerConfig.loader : {}
    });

    const cssresult = result.split('/').join(path.sep).replace(/js$/i, 'css');
    if (fs.existsSync(cssresult)) {
        let cssfile = outfile;
        if (outfile.endsWith('js')) cssfile = outfile.replace(/js$/i, 'css');
        else cssfile += '.css';

        fs.renameSync(
            cssresult,
            path.join(outdir, cssfile)
        );
    }

    console.timeEnd(timerLabel);
    return { skipped: false, changed };
}

///copy specific assets for rebundling outside the main context
export async function hotBundle(
    bundlerConfig = defaultBundler,
    changed = '',
    hotSwapOptions = {}
) {
    const options = mergeOptions(bundlerConfig, hotSwapOptions);
    const queue = getHotBundleQueue(bundlerConfig, options);
    return queue.request(changed, hotSwapOptions);
}

export async function hotBundleImmediate(
    bundlerConfig = defaultBundler,
    changed = ''
) {
    return hotBundleNow(bundlerConfig, changed);
}
