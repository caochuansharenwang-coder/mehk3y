        // --- CONFIG ---
        const CONFIG = {
            startFrustration: 50,
            passiveGain: 8,         
            anxietyGainPassive: 2, 
            refuseCost: 0, 
            chatCost: 3,
            hospitalCost: 10,       
            
            rewards: {
                oral_condom: 6, 
                oral_raw: 12,
                sex_condom: 10,
                sex_raw: 22 
            },

            stress: {
                oral_condom: 2,
                oral_raw: 15,
                sex_condom: 5,
                sex_raw: 30
            }
        };

        // --- STATE ---
        let STATE = {
            frustration: 50,
            anxiety: 0,
            turn: 1,
            items: { testkit: 1 },
            currentPartner: null,
            partnerGender: "female",
            isInfected: false,
            infectionData: null,
            isGameOver: false,
            history: [] // { partner, action, outcomeLabel, outcomeClass }
        };

        const AVATARS = {
            male: ['🌚', '🦊', '🐶', '🐲', '👽', '🤡', '🤠', '👻', '🧛', '🧟', '🧔', '👨'],
            female: ['🌝', '🦊', '🐱', '🦄', '🐙', '👽', '👻', '🧛‍♀️', '🧟‍♀️', '👩', '👱‍♀️', '💃']
        };

        const DISEASES = {
            HIV: { name: "艾滋病 (HIV)", riskType: "fluid", desc: "免疫崩溃，不可逆转。", transmission: "体液传播" },
            SYPHILIS: { name: "梅毒", riskType: "contact", desc: "全身红斑，侵蚀神经。", transmission: "接触传播" },
            HERPES: { name: "疱疹", riskType: "skin", desc: "终身携带，反复剧痛。", transmission: "皮肤接触" },
            HPV: { name: "尖锐湿疣", riskType: "contact", desc: "菜花突起，极难根治。", transmission: "接触传播" },
            GONORRHEA: { name: "淋病", riskType: "fluid_mucous", desc: "流脓刺痛。", transmission: "体液粘膜" },
            CRABS: { name: "阴虱", riskType: "skin_hair", desc: "剧烈瘙痒。", transmission: "密切接触" }
        };

        const FLIRT_LINES = [
            "今晚去你家，还是我家？",
            "别说话，吻我。",
            "我可是很挑剔的...",
            "听说你很会玩？",
            "关了灯，大家都是一样的。",
            "今晚不想一个人睡。",
            "你看起来...很美味。",
            "要不要试试更刺激的？",
            "长夜漫漫，无心睡眠。",
            "别害羞，靠近点。",
            "我的忍耐是有限度的。",
            "你敢不敢和我赌一把？"
        ];

        const ALL_TAGS = [
            { text: "手掌/脚底有红斑", color: "bg-red-700", risk: { SYPHILIS: 0.95 }, clue: "如果你看到这个，跑！这是梅毒二期的典型铁证。", hiddenChance: 0.8 },
            { text: "私处长了个硬硬的红疮", color: "bg-red-700", risk: { SYPHILIS: 0.98 }, clue: "这就叫『硬下疳』。不痛不痒，但那是梅毒一期。", hiddenChance: 0.9 },
            { text: "嘴角/下面长了一簇水泡", color: "bg-red-700", risk: { HERPES: 0.9 }, clue: "疱疹正在发作，水泡液里全是病毒，碰一下就中招。", hiddenChance: 0.9 },
            { text: "内裤上有黄色脓渍", color: "bg-red-600", risk: { GONORRHEA: 0.9 }, clue: "尿道流脓，典型的淋病症状。真的很脏。", hiddenChance: 0.5 },
            { text: "后面长了菜花状的小肉粒", color: "bg-red-800", risk: { HPV: 0.95, SYPHILIS: 0.4 }, clue: "尖锐湿疣。如果不切除会越长越大，像菜花一样。", hiddenChance: 0.9 },
            { text: "毛发根部有会动的黑痂", color: "bg-red-800", risk: { CRABS: 0.95 }, clue: "那不是脏东西，是阴虱和它的卵。它会爬到你身上。", hiddenChance: 0.7 },
            { text: "张嘴看到舌头白得像发霉", color: "bg-red-800", risk: { HIV: 0.6, SYPHILIS: 0.3 }, clue: "鹅口疮。成年人很少得，除非免疫系统崩了（比如艾滋病）。", hiddenChance: 0.5 },
            { text: "身上有紫红色的斑块", color: "bg-purple-800", risk: { HIV: 0.7 }, clue: "疑似卡波西肉瘤，艾滋病发病期的标志之一。", hiddenChance: 0.8 },
            { text: "头发像被虫蛀了一样稀疏", color: "bg-purple-700", risk: { SYPHILIS: 0.6 }, clue: "梅毒性脱发，通常是虫蚀状的，不是普通的秃顶。", hiddenChance: 0.3 },
            { text: "脖子/腋下摸起来有肿块", color: "bg-purple-700", risk: { HIV: 0.4, SYPHILIS: 0.4 }, clue: "全身淋巴结肿大，身体正在对抗病毒。", hiddenChance: 0.7 },
            { text: "躯干长满了不痒的红疹", color: "bg-purple-700", risk: { SYPHILIS: 0.5, HIV: 0.2 }, clue: "梅毒疹通常不痛不痒，很容易被误认为是过敏。", hiddenChance: 0.8 },
            { text: "舌头侧面有白色毛状物", color: "bg-purple-800", risk: { HIV: 0.8 }, clue: "毛状白斑，免疫系统严重受损的信号。", hiddenChance: 0.6 },
            // 环境/行为
            { text: "房间里有刺鼻的化学味", color: "bg-rose-900", risk: { HIV: 0.4, SYPHILIS: 0.3 }, clue: "RUSH(亚硝酸盐)的味道。玩这么大，通常伴随无套群交。", hiddenChance: 0.5 },
            { text: "床头放着奇怪的蓝瓶药", color: "bg-purple-800", risk: { HIV: 0.5 }, clue: "可能是必妥维(抗病毒药)或阻断药。说明他可能就是感染者。", hiddenChance: 0.7 },
            { text: "胳膊弯处有针孔/淤青", color: "bg-rose-900", risk: { HIV: 0.9, SYPHILIS: 0.6 }, clue: "静脉注射吸毒。这是绝对的高危禁区，血液传播风险极高。", hiddenChance: 0.8 },
            { text: "提议去公园/公厕解决", color: "bg-rose-900", risk: { SYPHILIS: 0.4, HIV: 0.3 }, clue: "野外游击队(Cruising)。环境极脏，且通常有多性伴。", hiddenChance: 0 },
            { text: "刚参加完多人派对", color: "bg-rose-900", risk: { HIV: 0.5, SYPHILIS: 0.5, GONORRHEA: 0.5 }, clue: "交叉感染的温床。你永远不知道上一个人是谁。", hiddenChance: 0.6 },
            { text: "也是刚约完上一个人", color: "bg-rose-800", risk: { GONORRHEA: 0.4, SYPHILIS: 0.3 }, clue: "无缝衔接。这种频率，中招是迟早的事。", hiddenChance: 0.5 },
            { text: "说『我就蹭蹭不进去』", color: "bg-rose-700", risk: { HERPES: 0.3, HPV: 0.3 }, clue: "著名的渣男谎言。而且蹭蹭也能传染皮肤病。", hiddenChance: 0 },
            { text: "说『如果你是干净的就能无套』", color: "bg-rose-900", risk: { HIV: 0.2 }, clue: "典型的话术PUA。这就是想骗你无套。", hiddenChance: 0 },
            { text: "脖子上有新鲜的吻痕", color: "bg-rose-800", risk: { HIV: 0.1, SYPHILIS: 0.1 }, clue: "私生活混乱的直接证据，可能昨晚还在别人床上。", hiddenChance: 0.3 },
            // 身份
            { text: "体育学院猛男", color: "bg-slate-700", risk: { GONORRHEA: 0.2, CRABS: 0.2 }, clue: "荷尔蒙爆棚，但男生宿舍的卫生状况...懂的都懂。", hiddenChance: 0 },
            { text: "沉迷二次元的死宅", color: "bg-slate-600", risk: {}, constraint: "no_oral", clue: "【限制】三次元的体液接触让他感到恶心，拒绝口交。", hiddenChance: 0.1 },
            { text: "艺术学院留长发男", color: "bg-purple-700", risk: { SYPHILIS: 0.1, GONORRHEA: 0.1 }, clue: "搞艺术的都很疯，且多情。私生活可能比他的画还抽象。", hiddenChance: 0 },
            { text: "备战考研压力怪", color: "bg-amber-700", risk: {}, constraint: "no_oral", clue: "【限制】只想快速发泄压力，没时间前戏，速战速决。", hiddenChance: 0 },
            { text: "满嘴骚话的键盘侠", color: "bg-slate-500", risk: {}, constraint: "oral_only", clue: "【限制】线上巨人线下怂包，见面只敢动动嘴，不敢真枪实弹。", hiddenChance: 0.3 },
            { text: "学生会", color: "bg-slate-700", risk: { HPV: 0.1 }, clue: "表面光鲜亮丽，背地里可能玩得很花。", hiddenChance: 0 },
            { text: "纯爱战神(自称)", color: "bg-sky-700", risk: {}, constraint: "oral_only", clue: "【限制】坚持要把第一次留给未来的老婆/老公，今晚只能边缘。", hiddenChance: 0.2 },
            { text: "App显示24小时在线", color: "bg-purple-800", risk: { HIV: 0.15, SYPHILIS: 0.15 }, clue: "住在软件上的极度活跃用户，常在河边走，哪有不湿鞋。", hiddenChance: 0 },
            { text: "职业性工作者", color: "bg-amber-800", risk: { HIV: 0.1, SYPHILIS: 0.1, GONORRHEA: 0.3 }, clue: "职业暴露风险高。", hiddenChance: 0.3 },
            { text: "经常去夜店/蹦迪", color: "bg-amber-700", risk: { HIV: 0.1 }, clue: "酒精、药物和冲动的温床，判断力最差的地方。", hiddenChance: 0 },
            { text: "金融男/投行精英", color: "bg-slate-700", risk: { SYPHILIS: 0.15 }, clue: "圈内传闻：压力大，玩得花，体检少。", hiddenChance: 0 },
            { text: "摇滚乐队乐手", color: "bg-slate-700", risk: { GONORRHEA: 0.1 }, clue: "果儿多，生活不规律，卫生习惯随缘。", hiddenChance: 0 },
            { text: "刚失恋求安慰", color: "bg-slate-600", risk: {}, clue: "情绪不稳定，容易为了报复前任而发生冲动行为。", hiddenChance: 0 },
            { text: "已婚寻找刺激", color: "bg-slate-700", risk: { HPV: 0.1 }, clue: "可能把家里的病带出来，也可能把病带回家。", hiddenChance: 0.4 },
            { text: "飞行员/空乘", color: "bg-slate-700", risk: { GONORRHEA: 0.1, SYPHILIS: 0.1 }, clue: "全世界飞，伴侣不固定，性病地图收集者。", hiddenChance: 0 },
            // 卫生
            { text: "指甲缝里全是黑泥", color: "bg-amber-800", risk: { GONORRHEA: 0.3, SYPHILIS: 0.1 }, clue: "个人卫生极差。手都洗不干净，别的地方更不用说了。", hiddenChance: 0 },
            { text: "极度消瘦/脸颊凹陷", color: "bg-purple-700", risk: { HIV: 0.35 }, clue: "可能是艾滋病消耗期，也可能是吸毒吸的。", hiddenChance: 0.2 },
            { text: "一直在咳嗽/盗汗", color: "bg-purple-700", risk: { HIV: 0.2 }, clue: "免疫力低下的表现，需警惕。", hiddenChance: 0.3 },
            { text: "坚持不开灯/只开夜灯", color: "bg-purple-900", risk: { SYPHILIS: 0.4, HERPES: 0.4, HPV: 0.4 }, clue: "最经典的伪装。黑暗是为了掩饰身上的溃疡或皮疹。", hiddenChance: 0 }, 
            { text: "大热天非要穿高领", color: "bg-purple-800", risk: { SYPHILIS: 0.5, HIV: 0.2 }, clue: "欲盖弥彰。可能在遮挡吻痕，也可能是皮疹或淋巴肿大。", hiddenChance: 0 },
            { text: "内裤松松垮垮/很旧", color: "bg-slate-600", risk: {}, clue: "不修边幅，可能对生活品质要求不高，但不一定有病。", hiddenChance: 0 },
            // 安全/正面
            { text: "清纯男大", color: "bg-emerald-800", risk: {}, safeChance: 0.85, clue: "眼神里透着未被知识污染的光。大概率是干净的。", hiddenChance: 0 },
            { text: "性压抑的小处男", color: "bg-emerald-800", risk: {}, safeChance: 0.85, constraint: "no_condom", clue: "【限制】因为太紧张，甚至不知道怎么戴套，或者一戴就软。", hiddenChance: 0.2 },
            { text: "医学院学生/医生", color: "bg-emerald-800", risk: {}, safeChance: 0.85, clue: "有医学常识，见过太多烂病，通常极度注意防护。", hiddenChance: 0 },
            { text: "疾控中心(CDC)员工", color: "bg-emerald-800", risk: {}, safeChance: 0.98, clue: "专业人士，这方面绝对稳。", hiddenChance: 0 },
            { text: "处女座/重度洁癖", color: "bg-sky-700", risk: {}, safeChance: 0.8, clue: "进门先洗半小时澡，甚至要求你也洗两遍。安全感满满。", hiddenChance: 0 },
            { text: "定期献血者", color: "bg-emerald-700", risk: {}, safeChance: 0.9, clue: "血站会进行严格的核酸检测，能献血说明血液大概率干净。", hiddenChance: 0.4 },
            { text: "当面拆封阴性检测单", color: "bg-emerald-700", risk: {}, safeChance: 0.95, clue: "目前最可靠的凭证（注意看日期是不是最近的）。", hiddenChance: 0.5 },
            { text: "包里自备各种安全套", color: "bg-sky-700", risk: {}, safetyBonus: true, constraint: "condom_only", clue: "安全意识极强，大概率对自己和他人都负责。", hiddenChance: 0.3 },
            { text: "明确拒绝无套提议", color: "bg-sky-700", risk: {}, safetyBonus: true, constraint: "condom_only", clue: "有原则的人通常比较安全。", hiddenChance: 0 },
            { text: "马拉松/铁三运动员", color: "bg-emerald-600", risk: {}, safeChance: 0.7, clue: "生活极度自律，身体素质好，免疫力强。", hiddenChance: 0 },
            // 限制
            { text: "急性子/不想洗澡", color: "bg-amber-800", risk: { GONORRHEA: 0.2 }, constraint: "no_oral", clue: "【限制】嫌麻烦，不洗澡太脏了，拒绝口交。", hiddenChance: 0.3 },
            { text: "对乳胶/橡胶过敏", color: "bg-rose-800", risk: {}, constraint: "no_condom", clue: "【限制】生理原因无法戴普通套。", hiddenChance: 0.4 }, 
            { text: "特别讨厌橡胶味", color: "bg-rose-800", risk: { HIV: 0.15 }, constraint: "no_condom", clue: "【限制】心理抵触戴套。如果你坚持，只能离开。", hiddenChance: 0.2 }, 
            { text: "嘴里刚做了牙科手术", color: "bg-slate-700", risk: {}, constraint: "no_oral", clue: "【限制】物理上无法张嘴，无法口交。", hiddenChance: 0 },
            { text: "嘴里有溃疡/起泡", color: "bg-red-800", risk: { HIV: 0.2, SYPHILIS: 0.3 }, constraint: "no_oral", clue: "【限制】嘴疼无法口交，且有体液传播风险。", hiddenChance: 0.6 },
            { text: "比较保守/只敢边缘", color: "bg-sky-800", risk: {}, constraint: "oral_only", clue: "【限制】胆子小，拒绝插入，只接受手口。", hiddenChance: 0 },
            { text: "有宗教信仰(婚前守贞)", color: "bg-sky-800", risk: {}, constraint: "oral_only", clue: "【限制】底线是不能插入，其他好商量。", hiddenChance: 0.2 },
            { text: "刚做完包皮手术", color: "bg-slate-700", risk: {}, constraint: "oral_only", clue: "【限制】还在恢复期，不能剧烈运动，只能你帮他。", hiddenChance: 0 },
            { text: "正在生理期/大姨妈", color: "bg-rose-900", risk: { HIV: 0.3 }, constraint: "oral_only", clue: "【限制】浴血奋战风险太高，拒绝插入。", hiddenChance: 0.5 },
            { text: "室友就在隔壁", color: "bg-slate-600", risk: {}, constraint: "oral_only", clue: "【限制】不敢发出声音，只能悄悄来。", hiddenChance: 0.1 }
        ];

        function toggleHelp() {
            const modal = document.getElementById('help-modal');
            modal.classList.toggle('hidden');
        }

        function toggleHistoryView(show) {
            const summaryView = document.getElementById('summary-view');
            const historyView = document.getElementById('history-view');
            
            if(show) {
                summaryView.classList.add('hidden');
                historyView.classList.remove('hidden');
            } else {
                summaryView.classList.remove('hidden');
                historyView.classList.add('hidden');
            }
        }

        // --- GAME LOGIC ---

        function startGame() {
            const selectedGender = document.querySelector('input[name="partner-gender"]:checked');
            STATE.partnerGender = selectedGender ? selectedGender.value : "female";
            document.getElementById('intro-modal').style.display = 'none';
            document.getElementById('game-container').classList.remove('hidden');
            initGame();
        }

        function returnToIntro() {
            document.getElementById('feedback-overlay').classList.add('hidden');
            document.getElementById('game-container').classList.add('hidden');
            document.getElementById('intro-modal').style.display = 'flex';
        }

        function initGame() {
            STATE.frustration = CONFIG.startFrustration;
            STATE.anxiety = 0;
            STATE.turn = 1;
            STATE.items = { testkit: 1 };
            if (!STATE.partnerGender) STATE.partnerGender = "female";
            STATE.isGameOver = false;
            STATE.isInfected = false;
            STATE.infectionData = null;
            STATE.history = []; // Reset history
            
            updateStatsUI();
            generateNewPartner();
        }

        function getCurrentPartnerGender() {
            if (STATE.partnerGender === "any") return Math.random() < 0.5 ? "female" : "male";
            return STATE.partnerGender;
        }

        function adaptTextForGender(text, gender) {
            if (gender !== "female") return text;
            const replacements = [
                ["体育学院猛男", "体育学院辣妹"],
                ["艺术学院留长发男", "艺术学院文艺女"],
                ["金融男/投行精英", "金融女/投行精英"],
                ["清纯男大", "清纯女大"],
                ["性压抑的小处男", "性压抑的小处女"],
                ["刚做完包皮手术", "刚做完妇科小手术"],
                ["男生宿舍", "女生宿舍"],
                ["他可能", "她可能"],
                ["他的", "她的"],
                ["他感到", "她感到"],
                ["他。", "她。"],
                ["给未来的老婆/老公", "给未来的老公/老婆"],
                ["你帮他", "你帮她"]
            ];
            return replacements.reduce((value, [from, to]) => value.split(from).join(to), text);
        }

        function adaptTagForGender(tag, gender) {
            if (gender !== "female") return { ...tag };
            return {
                ...tag,
                text: adaptTextForGender(tag.text, gender),
                clue: adaptTextForGender(tag.clue || "", gender)
            };
        }

        function generateNewPartner() {
            const partnerGender = getCurrentPartnerGender();
            const numTags = Math.floor(Math.random() * 2) + 3; 
            const partnerTags = [];
            const selectedIndices = new Set();
            const isCarrier = Math.random() < 0.4;
            const hasConstraint = Math.random() < 0.4;

            let loopLimit = 0;
            while(partnerTags.length < numTags && loopLimit < 100) {
                loopLimit++;
                const idx = Math.floor(Math.random() * ALL_TAGS.length);
                if(selectedIndices.has(idx)) continue;
                const tagTemplate = ALL_TAGS[idx];
                if (partnerGender === "male" && /生理期|大姨妈/.test(tagTemplate.text)) continue;
                if (isCarrier && partnerTags.length === 0 && !tagTemplate.color.includes('red') && !tagTemplate.color.includes('purple')) continue;
                if (hasConstraint && !partnerTags.some(t => t.constraint) && !tagTemplate.constraint && loopLimit < 50) continue;
                
                const currentConstraints = partnerTags.map(t => t.constraint).filter(Boolean);
                if (tagTemplate.constraint) {
                    if (tagTemplate.constraint === 'no_oral' && currentConstraints.includes('oral_only')) continue;
                    if (tagTemplate.constraint === 'oral_only' && currentConstraints.includes('no_oral')) continue;
                }
                selectedIndices.add(idx);
                let isHidden = false;
                const currentHiddenCount = partnerTags.filter(t => !t.revealed).length;
                if (currentHiddenCount === 0 && tagTemplate.hiddenChance > 0) isHidden = Math.random() < tagTemplate.hiddenChance;
                partnerTags.push({ ...adaptTagForGender(tagTemplate, partnerGender), revealed: !isHidden });
            }
            if (partnerTags.every(t => !t.revealed)) partnerTags[0].revealed = true;

            let activeDiseases = [];
            if (Math.random() < 0.05) { 
                const keys = Object.keys(DISEASES);
                activeDiseases.push(keys[Math.floor(Math.random() * keys.length)]);
            }
            partnerTags.forEach(tag => {
                if (tag.risk) {
                    for (const [dKey, prob] of Object.entries(tag.risk)) {
                        if (Math.random() < prob && !activeDiseases.includes(dKey)) activeDiseases.push(dKey);
                    }
                }
                if (tag.safeChance && Math.random() < tag.safeChance) activeDiseases = [];
            });

            STATE.currentPartner = {
                tags: partnerTags,
                diseases: activeDiseases,
                gender: partnerGender,
                avatar: AVATARS[partnerGender][Math.floor(Math.random() * AVATARS[partnerGender].length)]
            };

            renderPartner();
        }

        function updateStatsUI() {
            const fBar = document.getElementById('frustration-bar');
            fBar.style.width = `${STATE.frustration}%`;
            document.getElementById('frustration-val').innerText = `${STATE.frustration}%`;
            
            const aBar = document.getElementById('anxiety-bar');
            aBar.style.width = `${STATE.anxiety}%`;
            document.getElementById('anxiety-val').innerText = `${STATE.anxiety}%`;
            
            const gameContent = document.getElementById('game-content');
            const panicWarn = document.getElementById('panic-warning');
            
            if (STATE.anxiety >= 80) {
                gameContent.classList.add('panic-mode');
                panicWarn.classList.remove('hidden');
                aBar.classList.add('bg-violet-500'); aBar.classList.remove('bg-gradient-to-r');
            } else {
                gameContent.classList.remove('panic-mode');
                panicWarn.classList.add('hidden');
                aBar.classList.remove('bg-violet-500'); aBar.classList.add('bg-gradient-to-r');
            }

            document.getElementById('turn-count').innerText = STATE.turn.toString().padStart(2, '0');
            document.getElementById('item-testkit').innerText = `x${STATE.items.testkit}`;
            if(STATE.items.testkit === 0) document.getElementById('item-testkit').className = "text-xs font-bold text-slate-600";
        }

        function renderPartner() {
            const p = STATE.currentPartner;
            document.getElementById('avatar-emoji').innerText = p.avatar;
            document.getElementById('partner-status').classList.add('hidden');
            document.getElementById('flirt-text').innerText = `"${FLIRT_LINES[Math.floor(Math.random() * FLIRT_LINES.length)]}"`;
            
            const container = document.getElementById('tags-container');
            container.innerHTML = '';

            let constraints = [];
            let hiddenCount = 0;
            const isPanic = STATE.anxiety >= 80;

            p.tags.forEach((tag, index) => {
                const div = document.createElement('div');
                const forceHide = isPanic && Math.random() < 0.5;
                if (!tag.revealed || forceHide) {
                    hiddenCount++;
                    div.className = `tag-badge px-3 py-1.5 rounded-lg text-xs font-bold text-slate-500 bg-slate-900 border border-slate-700 shadow-sm mb-1 flex items-center gap-1.5 cursor-help`;
                    div.innerHTML = isPanic ? `<span class="blur-sm">???</span>` : `<span>❓</span> 隐藏信息`;
                } else {
                    if (tag.constraint) constraints.push(tag.constraint);
                    div.className = `tag-badge tag-reveal px-3 py-1.5 rounded-lg text-xs font-bold text-white shadow-lg mb-1 flex items-center gap-1.5 border border-white/10 ${tag.color}`;
                    let icon = '⏺';
                    if(tag.color.includes('red')) icon = '⚠️';
                    else if(tag.constraint) icon = '🚫';
                    else if(tag.color.includes('emerald')) icon = '🛡️';
                    div.innerHTML = `<span class="opacity-75">${icon}</span> ${tag.text}`;
                }
                container.appendChild(div);
            });

            resetButtons();
            if (constraints.length > 0) applyConstraints(constraints);

            const chatBtn = document.getElementById('btn-chat');
            if (hiddenCount === 0 && !isPanic) {
                chatBtn.classList.add('opacity-50', 'cursor-not-allowed');
                chatBtn.disabled = true;
                chatBtn.innerHTML = `<span>💬</span> 已完全了解`;
            } else {
                chatBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                chatBtn.disabled = false;
                chatBtn.innerHTML = `<span>💬</span> 试探 / 聊天 <span class="opacity-50 text-[10px] font-normal ml-1">(压抑值+3)</span>`;
            }
        }

        function resetButtons() {
            const ids = ['btn-oral-condom', 'btn-oral-raw', 'btn-sex-condom', 'btn-sex-raw'];
            ids.forEach(id => {
                const btn = document.getElementById(id);
                btn.disabled = false;
                btn.classList.remove('btn-disabled');
                const overlay = btn.querySelector('.disabled-overlay');
                if(overlay) overlay.remove();
            });
        }

        function applyConstraints(constraints) {
            constraints.forEach(c => {
                if (c === 'no_condom') {
                    disableBtn('btn-oral-condom');
                    disableBtn('btn-sex-condom');
                } else if (c === 'condom_only') {
                    disableBtn('btn-oral-raw');
                    disableBtn('btn-sex-raw');
                } else if (c === 'no_oral') {
                    disableBtn('btn-oral-condom');
                    disableBtn('btn-oral-raw');
                } else if (c === 'oral_only') {
                    disableBtn('btn-sex-condom');
                    disableBtn('btn-sex-raw');
                }
            });
        }

        function disableBtn(id) {
            const btn = document.getElementById(id);
            if (!btn.disabled) {
                btn.disabled = true;
                btn.classList.add('btn-disabled');
                const span = document.createElement('div');
                span.className = 'disabled-overlay absolute inset-0 flex items-center justify-center bg-black/60 text-rose-500 font-bold rotate-[-3deg] text-[10px] uppercase border border-rose-500/30 rounded-xl backdrop-blur-[1px]';
                span.innerText = "对方拒绝";
                btn.appendChild(span);
            }
        }

        // --- ACTIONS & HISTORY ---

        function advanceTime(fCost, aCost = 0) {
            STATE.turn++;
            STATE.frustration += fCost;
            STATE.anxiety += aCost;
            if (STATE.anxiety > 20) STATE.anxiety += CONFIG.anxietyGainPassive;
            if (STATE.frustration > 100) STATE.frustration = 100;
            if (STATE.anxiety > 100) STATE.anxiety = 100;
            updateStatsUI();
            
            if (STATE.frustration >= 100) {
                showGameOver("欲火焚身", "长期的压抑让你彻底失去了理智。你无法再思考后果，在绝望中发生了一次随机的高危行为。", "🤯");
                return true;
            }
            if (STATE.anxiety >= 100) {
                showGameOver("精神崩溃", "巨大的心理压力压垮了你。你开始出现幻觉，被送往了精神病院，游戏结束。", "😵‍💫");
                return true;
            }
            return false;
        }

        function recordHistory(action, infectedThisTurn) {
            const p = STATE.currentPartner;
            let outcomeLabel = "", outcomeClass = "";
            
            const isDiseased = p.diseases.length > 0;

            if (action === 'refuse') {
                if (isDiseased) {
                    outcomeLabel = "🛡️ 正确离开"; outcomeClass = "text-emerald-400 border-emerald-500/30 bg-emerald-900/20";
                } else {
                    outcomeLabel = "👋 遗憾错过"; outcomeClass = "text-slate-400 border-slate-500/30 bg-slate-800";
                }
            } else {
                if (infectedThisTurn) {
                    outcomeLabel = "💀 被ta感染"; outcomeClass = "text-rose-500 border-rose-500/30 bg-rose-900/30";
                } else if (isDiseased) {
                    outcomeLabel = "😰 死里逃生"; outcomeClass = "text-amber-400 border-amber-500/30 bg-amber-900/20";
                } else {
                    outcomeLabel = "✅ 理智享受"; outcomeClass = "text-blue-400 border-blue-500/30 bg-blue-900/20";
                }
            }

            STATE.history.push({
                avatar: p.avatar,
                tags: p.tags,
                diseases: p.diseases,
                action: action,
                outcomeLabel: outcomeLabel,
                outcomeClass: outcomeClass
            });
        }

        function renderHistoryList() {
            const list = document.getElementById('history-list');
            list.innerHTML = '';
            
            STATE.history.forEach((item, idx) => {
                const div = document.createElement('div');
                div.className = "flex items-start gap-3 p-3 bg-slate-800/50 rounded-lg border border-white/5";
                
                // Avatar status
                let statusIcon = item.diseases.length > 0 ? "<span class='absolute -bottom-1 -right-1 text-[10px]'>🦠</span>" : "";
                
                // Tags
                let tagHTML = item.tags.map(t => `<span class='inline-block px-1.5 py-0.5 rounded bg-slate-700 text-[10px] text-slate-300 mr-1 mb-1'>${t.text}</span>`).join("");
                if (item.diseases.length > 0) {
                     tagHTML += `<br><span class='text-[10px] text-rose-400 font-bold'>携带: ${item.diseases.map(d => DISEASES[d].name).join(", ")}</span>`;
                } else {
                     tagHTML += `<br><span class='text-[10px] text-emerald-500/50'>健康</span>`;
                }

                div.innerHTML = `
                    <div class="relative text-2xl bg-slate-900 rounded-full w-10 h-10 flex items-center justify-center border border-white/10 flex-shrink-0">
                        ${item.avatar} ${statusIcon}
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="mb-1 leading-tight">${tagHTML}</div>
                    </div>
                    <div class="flex-shrink-0 ml-2">
                        <span class="px-2 py-1 rounded text-[10px] font-bold border ${item.outcomeClass}">${item.outcomeLabel}</span>
                    </div>
                `;
                list.appendChild(div);
            });
        }

        function useItem(type) {
            if (type === 'testkit' && STATE.items.testkit > 0) {
                STATE.items.testkit--;
                const p = STATE.currentPartner;
                let msg = "", icon = "";
                if (p.diseases.length > 0) {
                    const names = p.diseases.map(d => DISEASES[d].name).join(", ");
                    msg = `<span class="text-rose-400 font-bold">⚠️ 阳性反应！</span><br>病原体：${names}。<br>请立即离开。`;
                    icon = "🦠";
                    document.getElementById('partner-status').classList.remove('hidden');
                } else {
                    msg = `<span class="text-emerald-400 font-bold">✅ 阴性。</span><br>未检测到常见病原体。<br>(注：无法检测窗口期极短的病毒)`;
                    icon = "🛡️";
                }
                p.tags.forEach(t => t.revealed = true);
                renderPartner();
                updateStatsUI();
                showFeedback("检测结果", msg, icon, true); 
            }
        }

        function goToHospital() {
            const survive = !advanceTime(CONFIG.hospitalCost, 0); 
            if (!survive) return;

            STATE.anxiety = 0;
            updateStatsUI();

            if (STATE.isInfected) {
                showGameOver("确诊感染", `很遗憾，医院的检查结果显示你已感染。<br>之前的侥幸心理终究没能救你。`, "🏥", STATE.infectionData);
            } else {
                showFeedback("虚惊一场", "<span class='text-emerald-400 font-bold'>检测结果阴性。</span><br>你身体是健康的。心理压力已清空，但你也为此浪费了宝贵的时间（压抑值大幅上升）。", "🏥", true);
            }
        }

        function nextTurn() {
            document.getElementById('feedback-overlay').classList.add('hidden');
            // Reset views
            toggleHistoryView(false);
            generateNewPartner();
        }

        function takeAction(actionType) {
            if (STATE.frustration >= 100 || STATE.anxiety >= 100) return;

            if (actionType === 'chat') {
                const p = STATE.currentPartner;
                const hiddenIndices = p.tags.map((t, i) => !t.revealed ? i : -1).filter(i => i !== -1);
                if (hiddenIndices.length > 0) {
                    const idx = hiddenIndices[Math.floor(Math.random() * hiddenIndices.length)];
                    p.tags[idx].revealed = true;
                    if(!advanceTime(CONFIG.chatCost, 0)) renderPartner();
                } else {
                    if(!advanceTime(CONFIG.chatCost, 0)) renderPartner();
                }
                return;
            }

            const partner = STATE.currentPartner;
            
            // Record infection status BEFORE this action to know if this specific action caused it
            const wasInfectedBefore = STATE.isInfected;
            let infectedThisTurn = false;

            if (actionType === 'refuse') {
                recordHistory('refuse', false);
                if(!advanceTime(CONFIG.passiveGain + CONFIG.refuseCost, 0)) {
                    showFeedback("继续寻找", "你选择了离开。压抑值上升，但至少你暂时是安全的。", "🏃");
                }
                return;
            }

            const reduction = CONFIG.rewards[actionType];
            const anxietyGain = CONFIG.stress[actionType];
            
            if (!STATE.isInfected && partner.diseases.length > 0) {
                for (let dKey of partner.diseases) {
                    const disease = DISEASES[dKey];
                    let chance = 0;
                    if (actionType === 'sex_raw') chance = 0.95; 
                    else if (actionType === 'oral_raw') chance = (disease.riskType.includes('skin') || disease.riskType.includes('mucous')) ? 0.5 : 0.1;
                    else if (actionType === 'sex_condom') {
                         if (disease.riskType === 'skin_hair') chance = 1.0; 
                         else if (disease.riskType === 'contact') chance = 0.3; 
                         else chance = 0.02; 
                    }
                    else if (actionType === 'oral_condom') chance = 0.01; 

                    if (Math.random() < chance) {
                        STATE.isInfected = true;
                        STATE.infectionData = disease;
                        infectedThisTurn = true;
                        break; 
                    }
                }
            }

            recordHistory(actionType, infectedThisTurn);

            STATE.frustration -= reduction;
            const frustrationDelta = CONFIG.passiveGain - reduction;
            
            if (advanceTime(frustrationDelta, anxietyGain)) return; 
            
            if (STATE.frustration < 0) STATE.frustration = 0;

            if (STATE.frustration === 0) {
                if (STATE.isInfected) {
                    showGameOver("糟糕的胜利", "你的压抑值清零了，你感到无比轻松...<br>但在几天后，你的身体开始出现异常反应。<br>你虽然释放了欲望，却输掉了健康。", "🥀", STATE.infectionData);
                } else {
                    showWin();
                }
            } else {
                let title = "宣泄与不安";
                let icon = "🍬"; 
                let msg = `欲望得到了释放。<br>生理压抑 <span class="text-emerald-400">-${reduction}</span>`;
                
                if (anxietyGain > 5) {
                    msg += `<br>心理压力 <span class="text-violet-400">+${anxietyGain}</span>`;
                    icon = "😰";
                }

                if (STATE.isInfected) {
                    msg += `<br><span class="text-xs text-slate-500 italic mt-2">你感觉到了一丝异样，但也许只是错觉...？</span>`;
                } else if (partner.diseases.length > 0) {
                    msg += `<br><span class="text-xs text-slate-500 italic mt-2">虽然过程很惊险，但你似乎运气不错...暂时。</span>`;
                }

                showFeedback(title, msg, icon);
            }
        }

        // --- UI HELPERS ---

        function getStatsHTML() {
            let counts = { enjoy: 0, escape: 0, leave: 0, miss: 0, infected: 0 };
            let actionCounts = { 
                sex_raw: 0, 
                sex_condom: 0, 
                oral_raw: 0, 
                oral_condom: 0, 
                refuse: 0 
            };

            STATE.history.forEach(h => {
                if (h.outcomeLabel.includes("理智享受")) counts.enjoy++;
                if (h.outcomeLabel.includes("死里逃生")) counts.escape++;
                if (h.outcomeLabel.includes("正确离开")) counts.leave++;
                if (h.outcomeLabel.includes("遗憾错过")) counts.miss++;
                if (h.outcomeLabel.includes("被ta感染")) counts.infected++;

                if (actionCounts[h.action] !== undefined) {
                    actionCounts[h.action]++;
                }
            });

            return `
                <div class="mt-4 bg-slate-950/50 rounded-xl p-3 border border-white/5 text-xs">
                    
                    <h4 class="text-slate-500 font-bold uppercase tracking-widest mb-2 text-center text-[10px]">生涯结果</h4>
                    <div class="grid grid-cols-2 gap-y-2 gap-x-4 mb-4">
                        <div class="flex justify-between items-center border-b border-white/5 pb-1">
                            <span class="text-blue-300">✅ 理智享受</span>
                            <span class="font-mono font-bold text-white text-sm">${counts.enjoy}</span>
                        </div>
                        <div class="flex justify-between items-center border-b border-white/5 pb-1">
                            <span class="text-emerald-300">🛡️ 正确离开</span>
                            <span class="font-mono font-bold text-white text-sm">${counts.leave}</span>
                        </div>
                        <div class="flex justify-between items-center border-b border-white/5 pb-1">
                            <span class="text-amber-300">😰 死里逃生</span>
                            <span class="font-mono font-bold text-white text-sm">${counts.escape}</span>
                        </div>
                        <div class="flex justify-between items-center border-b border-white/5 pb-1">
                            <span class="text-slate-400">👋 遗憾错过</span>
                            <span class="font-mono font-bold text-white text-sm">${counts.miss}</span>
                        </div>
                        <div class="col-span-2 flex justify-between items-center border-b border-white/5 pb-1 bg-rose-950/20 px-1 -mx-1 rounded">
                            <span class="text-rose-400 font-bold">💀 被感染次数</span>
                            <span class="font-mono font-black text-rose-400 text-sm">${counts.infected}</span>
                        </div>
                    </div>

                    <h4 class="text-slate-500 font-bold uppercase tracking-widest mb-2 text-center text-[10px]">行为统计 (次数)</h4>
                    <div class="grid grid-cols-2 gap-2 mb-2">
                        <div class="bg-rose-900/20 border border-rose-500/20 rounded p-1 text-center">
                            <div class="text-[9px] text-rose-300 opacity-70">无套性交</div>
                            <div class="font-mono font-bold text-rose-200">${actionCounts.sex_raw}</div>
                        </div>
                        <div class="bg-amber-900/20 border border-amber-500/20 rounded p-1 text-center">
                            <div class="text-[9px] text-amber-300 opacity-70">无套口交</div>
                            <div class="font-mono font-bold text-amber-200">${actionCounts.oral_raw}</div>
                        </div>
                        <div class="bg-emerald-900/20 border border-emerald-500/20 rounded p-1 text-center">
                            <div class="text-[9px] text-emerald-300 opacity-70">戴套性交</div>
                            <div class="font-mono font-bold text-emerald-200">${actionCounts.sex_condom}</div>
                        </div>
                        <div class="bg-slate-800/50 border border-white/10 rounded p-1 text-center">
                            <div class="text-[9px] text-slate-400 opacity-70">戴套口交</div>
                            <div class="font-mono font-bold text-slate-300">${actionCounts.oral_condom}</div>
                        </div>
                         <div class="col-span-2 bg-slate-800 border border-white/5 rounded p-1 flex justify-between px-3 items-center">
                            <div class="text-[9px] text-slate-400">👋 拒绝/离开</div>
                            <div class="font-mono font-bold text-white">${actionCounts.refuse}</div>
                        </div>
                    </div>

                    <div class="mt-2 pt-2 border-t border-white/10 flex justify-between items-center">
                        <span class="font-bold text-slate-300">⏱️ 存活回合</span>
                        <span class="font-mono font-black text-xl text-white">${STATE.turn - 1}</span>
                    </div>
                </div>
            `;
        }

        function showFeedback(title, msg, icon, isSimpleAlert = false) {
            const el = document.getElementById('feedback-overlay');
            el.classList.remove('hidden');
            document.getElementById('feedback-title').innerText = title;
            document.getElementById('feedback-icon').innerText = icon;
            document.getElementById('feedback-message').innerHTML = msg;
            
            document.getElementById('disease-report').classList.add('hidden');
            // Ensure we are in Summary View initially
            toggleHistoryView(false); 
            
            const nextBtn = document.getElementById('next-btn');
            const restartBtn = document.getElementById('restart-btn');
            const historyBtn = document.getElementById('view-history-btn');
            
            restartBtn.classList.add('hidden');
            nextBtn.classList.remove('hidden');
            historyBtn.classList.add('hidden'); // Default hide history btn
            
            if (isSimpleAlert) {
                nextBtn.innerText = "关闭";
                nextBtn.onclick = function() {
                    el.classList.add('hidden');
                    nextBtn.onclick = nextTurn; 
                    nextBtn.innerText = "继续";
                };
            } else {
                nextBtn.innerText = "继续";
                nextBtn.onclick = nextTurn;
            }
        }

        function showGameOver(title, msg, icon, disease = null) {
            STATE.isGameOver = true;
            const el = document.getElementById('feedback-overlay');
            el.classList.remove('hidden');
            
            const titleEl = document.getElementById('feedback-title');
            titleEl.innerText = title;
            titleEl.className = "text-3xl font-black text-rose-500 uppercase tracking-tighter animate-pulse";
            document.getElementById('feedback-icon').innerText = icon;
            
            // Append Stats including Choice Counts
            document.getElementById('feedback-message').innerHTML = msg + getStatsHTML();

            if (disease) {
                const report = document.getElementById('disease-report');
                report.classList.remove('hidden');
                document.getElementById('disease-content').innerHTML = 
                    `<p><b>确诊：</b>${disease.name}</p><p><b>途径：</b>${disease.transmission}</p>`;
            } else {
                document.getElementById('disease-report').classList.add('hidden');
            }

            // Prepare History List but don't show it yet
            renderHistoryList();
            toggleHistoryView(false);

            // Buttons
            document.getElementById('next-btn').classList.add('hidden');
            document.getElementById('restart-btn').classList.remove('hidden');
            document.getElementById('view-history-btn').classList.remove('hidden');
        }

        function showWin() {
            STATE.isGameOver = true;
            const el = document.getElementById('feedback-overlay');
            el.classList.remove('hidden');
            
            const titleEl = document.getElementById('feedback-title');
            titleEl.innerText = "幸存者";
            titleEl.className = "text-3xl font-black text-emerald-400 uppercase tracking-tighter";
            document.getElementById('feedback-icon').innerText = "✨";
            
            // Append Stats including Choice Counts
            document.getElementById('feedback-message').innerHTML = 
                `你成功清零了压抑值，且身体健康。<br><br>在这场充满迷雾和风险的游戏中，你靠着谨慎、策略和一点运气活了下来。` + getStatsHTML();

            document.getElementById('disease-report').classList.add('hidden');

            // Prepare History List
            renderHistoryList();
            toggleHistoryView(false);

            // Buttons
            document.getElementById('next-btn').classList.add('hidden');
            document.getElementById('restart-btn').classList.remove('hidden');
            document.getElementById('view-history-btn').classList.remove('hidden');
        }


        // --- Event wiring (replaces inline onclick handlers so the page needs no
        //     'unsafe-inline' in CSP). The game functions above are global. ---
        document.addEventListener('click', function (e) {
            var el = e.target.closest('[data-act]');
            if (el) {
                var fn = window[el.getAttribute('data-act')];
                if (typeof fn === 'function') {
                    var a = el.getAttribute('data-arg');
                    if (a === null) fn();
                    else if (a === 'true') fn(true);
                    else if (a === 'false') fn(false);
                    else fn(a);
                }
                return;
            }
            // Help modal: close only when the backdrop itself (not its panel) is clicked.
            var modal = e.target.closest('[data-modal-close]');
            if (modal && e.target === modal && typeof window.toggleHelp === 'function') {
                window.toggleHelp();
            }
        });
