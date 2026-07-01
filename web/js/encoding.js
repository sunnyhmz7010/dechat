const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function base62Encode(buffer) {
    const bytes = new Uint8Array(buffer);
    let result = '';
    let num = BigInt(0);
    
    for (let i = 0; i < bytes.length; i++) {
        num = num * BigInt(256) + BigInt(bytes[i]);
    }
    
    while (num > BigInt(0)) {
        result = BASE62_CHARS[Number(num % BigInt(62))] + result;
        num = num / BigInt(62);
    }
    
    return result || '0';
}

export function base62Decode(str) {
    let num = BigInt(0);
    
    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        const index = BASE62_CHARS.indexOf(char);
        if (index === -1) {
            throw new Error(`Invalid Base62 character: ${char}`);
        }
        num = num * BigInt(62) + BigInt(index);
    }
    
    const bytes = [];
    while (num > BigInt(0)) {
        bytes.unshift(Number(num % BigInt(256)));
        num = num / BigInt(256);
    }
    
    return new Uint8Array(bytes);
}
