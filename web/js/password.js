const WORDS = [
    '苹果','月亮','钥匙','森林','火车','钻石','河流','镜子','窗户','音乐',
    '风筝','雪花','狮子','蝴蝶','珊瑚','琥珀','珍珠','水晶','彩虹','火焰',
    '风暴','海洋','沙漠','绿洲','山峰','溪流','星辰','闪电','冰川','沙漠',
    '玫瑰','竹子','松树','莲花','兰花','菊花','桂花','桃花','梅花','樱花',
    '天鹅','海豚','鲸鱼','老鹰','孔雀','凤凰','麒麟','龙凤','白虎','玄武',
    '金丝','银杏','翡翠','玛瑙','琉璃','陶瓷','丝绸','棉麻','皮革','纸张',
    '铅笔','墨水','砚台','宣纸','毛笔','印章','算盘','罗盘','望远镜','显微镜',
    '钟表','沙漏','灯塔','风车','水车','帆船','热气球','降落伞','直升机','潜水艇',
    '咖啡','茶叶','牛奶','蜂蜜','糖果','蛋糕','饼干','巧克力','冰淇淋','果汁',
    '面包','米饭','面条','饺子','包子','馒头','烧饼','油条','春卷','汤圆',
    '钢琴','吉他','小提琴','大提琴','长笛','小号','鼓','铃铛','风铃','口琴',
    '画笔','颜料','画布','画框','雕塑','陶艺','摄影','电影','戏剧','舞蹈',
    '足球','篮球','排球','网球','乒乓球','羽毛球','棒球','高尔夫','游泳','滑雪',
    '宇宙','银河','黑洞','彗星','流星','卫星','火箭','空间站','探测器','宇航员',
    '原子','分子','电子','质子','中子','光子','量子','引力','磁场','电场',
    '算法','程序','数据','网络','芯片','传感器','机器人','人工智能','虚拟现实','区块链',
];

export function generateRecoveryPhrase(wordCount = 12) {
    const indices = new Uint32Array(wordCount);
    crypto.getRandomValues(indices);
    return Array.from(indices).map(i => WORDS[i % WORDS.length]);
}

export function phraseToSeed(phrase) {
    const words = phrase.split(/[\s,，、]+/).filter(w => w.length > 0);
    const enc = new TextEncoder();
    const combined = enc.encode(words.join(''));
    return crypto.subtle.digest('SHA-256', combined).then(hash => new Uint8Array(hash));
}

export function verifyPhrase(phrase) {
    const words = phrase.split(/[\s,，、]+/).filter(w => w.length > 0);
    if (words.length < 6) return { valid: false, error: '恢复短语至少需要6个词' };
    for (const word of words) {
        if (!WORDS.includes(word)) {
            return { valid: false, error: `未知的词: "${word}"` };
        }
    }
    return { valid: true };
}

export function generatePasswordHint() {
    return '请记住您的密码。密码用于加密本地存储的消息。';
}
