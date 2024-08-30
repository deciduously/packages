use std::env;

fn main() {
    println!("cargo::rustc-check-cfg=cfg(openssl111)");
    if let Ok(v) = env::var("DEP_OPENSSL_VERSION_NUMBER") {
        let version = u64::from_str_radix(&v, 16).unwrap();
        dbg!(version);

        if version >= 0x1_01_01_00_0 {
            println!("cargo::rustc-cfg=openssl111");
        }
    }
}
