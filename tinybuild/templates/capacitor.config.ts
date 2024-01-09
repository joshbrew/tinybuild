import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tinybuild.myapp',
  appName: 'MyApp',
  webDir: 'dist',
  bundledWebRuntime: false, //esbuild will do it for us
  // plugins:{
  //   "BluetoothLe":{
  //     "displayStrings": {
  //       "scanning":"Scanning BLE...",
  //       "cancel":"Stop Scanning",
  //       "availableDevices":"Devices available!",
  //       "noDeviceFound": "No BLE devices found."
  //     }
  //   }
  // }
};

export default config;
