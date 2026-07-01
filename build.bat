@echo off
echo Building SealedChat WASM...
cd crates\sealedchat-wasm
wasm-pack build --target web --out-dir ..\..\web\pkg
cd ..\..
echo Done! WASM output in web\pkg\
