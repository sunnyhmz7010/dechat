@echo off
echo Building DeChat WASM...
cd crates\dechat-wasm
wasm-pack build --target web --out-dir ..\..\web\pkg
cd ..\..
echo Done! WASM output in web\pkg\
