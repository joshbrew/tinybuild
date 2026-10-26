use std::io::{self, BufRead, Write};
fn main() {
    // One request/reply per line. Closing the parent's input pipe exits the backend.
    println!("ready {}", std::process::id());
    io::stdout().flush().unwrap();
    for line in io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        let response = match line.trim().parse::<u64>() {
            Ok(value) if value <= 1_000_000 => (value * value).to_string(),
            _ => "error: use an integer from 0 to 1000000".into(),
        };
        println!("{response}");
        if io::stdout().flush().is_err() { break }
    }
}
