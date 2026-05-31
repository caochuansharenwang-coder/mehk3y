/* levels.js - 2D半挂车停车模拟器关卡与训练场景定义 */

export const LEVELS = [
    {
        id: 1,
        name: {
            en: 'Straight Backing',
            zh: '直道倒车',
            ja: '直線バック',
            ko: '직선 후진',
            fr: 'Marche arrière en ligne droite',
            de: 'Geradeaus rückwärts'
        },
        description: {
            en: 'Basic drill: back the trailer in a straight line into the parking spot. Focus on tiny steering corrections to keep the rig straight.',
            zh: '基础训练：将挂车笔直向后倒，停入车位。重点是学会微调方向盘以保持车身呈直线。',
            ja: '基本練習：トレーラーをまっすぐ後退させて駐車スペースに入れます。車体を直線に保つための微細なステアリング修正がポイントです。',
            ko: '기본 훈련: 트레일러를 똑바로 후진시켜 주차 공간에 진입합니다. 차체를 직선으로 유지하기 위한 핸들 미세 조정이 핵심입니다.',
            fr: "Exercice de base : reculez la remorque en ligne droite jusqu'à la place. Concentrez-vous sur de petites corrections de direction pour rester aligné.",
            de: 'Grundübung: Schieben Sie den Anhänger geradeaus in die Parkbox. Wichtig sind feine Lenkkorrekturen, damit das Gespann gerade bleibt.'
        },
        tutorial: {
            en: "Tip: In reverse (R), to swing the trailer's rear to the right, steer LEFT (counterclockwise). Vice versa. Keep inputs small and slow — the moment the trailer starts drifting, counter-steer immediately to straighten it.",
            zh: '提示：在倒车(R挡)时，如果你想让挂车尾部向右偏，需要将方向盘向左打(逆时针)；反之亦然。动作要缓慢细微，一旦挂车开始偏转，立即反向微调方向盘将其拉直。',
            ja: 'ヒント：R レンジで後退中、トレーラー後部を右へ振りたい場合はハンドルを左（反時計回り）に切ります。逆も同様。動作はゆっくり小さく、トレーラーが振れ始めたら直ちに逆方向へ微調整して直進に戻します。',
            ko: '팁: 후진(R)에서 트레일러 뒷부분을 오른쪽으로 보내려면 핸들을 왼쪽(반시계)으로 돌립니다. 반대도 마찬가지입니다. 입력은 작고 천천히 — 트레일러가 흔들리기 시작하면 즉시 반대 방향으로 미세 조정하여 직선을 유지합니다.',
            fr: "Astuce : en marche arrière (R), pour envoyer l'arrière de la remorque vers la droite, tournez le volant à GAUCHE (sens antihoraire), et inversement. Faites des gestes lents et fins — dès que la remorque commence à dériver, contre-braquez pour la redresser.",
            de: 'Tipp: Im Rückwärtsgang (R) lenken Sie nach LINKS (gegen den Uhrzeigersinn), damit das Heck des Anhängers nach rechts wandert, und umgekehrt. Sehr feine, langsame Bewegungen — sobald der Anhänger ausbricht, sofort gegenlenken.'
        },
        initialState: {
            x: 480,
            y: 225,
            thetaC: 0,
            thetaT: 0
        },
        parkingSpot: {
            x: 130,
            y: 225,
            width: 36,
            length: 125,
            angle: 0
        },
        obstacles: [
            { x: 300, y: 155, width: 8, length: 600, angle: 0, type: 'wall' },
            { x: 300, y: 295, width: 8, length: 600, angle: 0, type: 'wall' }
        ]
    },
    {
        id: 2,
        name: {
            en: 'Alley Dock (90°)',
            zh: '90度直角倒库',
            ja: '90度バック駐車',
            ko: '90도 직각 후진 입고',
            fr: 'Marche arrière à 90°',
            de: '90° Rückwärtseinparken'
        },
        description: {
            en: 'Advanced drill: the classic semi-trailer test — back into a perpendicular dock at 90°.',
            zh: '高级训练：最经典的半挂车考题。车辆呈90度垂直状态下倒车入库。',
            ja: '上級練習：セミトレーラーの定番試験。車両を 90 度直角の状態で後退入庫します。',
            ko: '고급 훈련: 세미트레일러의 대표 시험 — 90도 직각으로 후진하여 입고합니다.',
            fr: 'Exercice avancé : le test classique du semi-remorque — reculez perpendiculairement à 90°.',
            de: 'Fortgeschrittene Übung: die klassische Sattelschlepper-Prüfung — 90° rückwärts in die Bucht.'
        },
        tutorial: {
            en: "Tip: At first, steer fully RIGHT to swing the trailer through almost 90°. As soon as the trailer's tail lines up with the dock entrance, quickly steer hard LEFT so the cab swings back in front of the dock — then push straight in.",
            zh: '提示：倒车初期需要将方向盘向右打满，让挂车进行接近90度的剧烈偏转。一旦挂车尾部瞄准了库位入口，必须提前并迅速向左大打方向盘，让车头倒回库位前方，形成一条直线推入库中。',
            ja: 'ヒント：序盤はハンドルを右いっぱいまで切り、トレーラーを 90 度近く大きく振らせます。トレーラー後端が入庫口に揃った瞬間、素早く左いっぱいまで切り返してヘッドを庫前に戻し、直線で押し込みます。',
            ko: '팁: 초반에는 핸들을 우측으로 끝까지 돌려 트레일러를 약 90도까지 크게 회전시킵니다. 트레일러 후미가 입구를 향하면 즉시 좌측으로 끝까지 꺾어 트랙터를 입구 앞으로 되돌린 뒤, 일직선으로 밀어 넣습니다.',
            fr: "Astuce : au début, braquez à fond à droite pour faire pivoter la remorque de presque 90°. Dès que son arrière vise l'entrée du quai, contre-braquez à fond à gauche pour ramener la cabine devant le quai, puis poussez tout droit.",
            de: 'Tipp: Anfangs voll nach rechts einschlagen, damit der Anhänger fast 90° schwenkt. Sobald das Anhängerende auf die Box zeigt, schnell voll nach links gegenlenken, damit die Zugmaschine vor die Box zurückkehrt — dann geradeaus reinschieben.'
        },
        initialState: {
            x: 320,
            y: 155,
            thetaC: 0,
            thetaT: 0
        },
        parkingSpot: {
            x: 110,
            y: 330,
            width: 36,
            length: 125,
            angle: Math.PI / 2
        },
        obstacles: [
            { x: 300, y: 90, width: 8, length: 600, angle: 0, type: 'wall' },
            { x: 80, y: 330, width: 8, length: 120, angle: Math.PI / 2, type: 'wall' },
            { x: 140, y: 330, width: 8, length: 120, angle: Math.PI / 2, type: 'wall' },
            { x: 420, y: 290, width: 120, length: 8, angle: 0, type: 'wall' }
        ]
    },
    {
        id: 3,
        name: {
            en: 'Offset Backing',
            zh: '平行车道偏移',
            ja: 'オフセットバック',
            ko: '평행 차선 후진',
            fr: 'Marche arrière avec décalage',
            de: 'Versetztes Rückwärtsfahren'
        },
        description: {
            en: 'Intermediate drill: reverse diagonally from your lane, past obstacles, into the adjacent parallel spot.',
            zh: '中级训练：将车从当前车道斜向后倒，越过障碍物，安全停入相邻的平行车位。',
            ja: '中級練習：現在の車線から斜め後方に進み、障害物を避けて隣の平行スペースに駐車します。',
            ko: '중급 훈련: 현재 차선에서 비스듬히 후진하여 장애물을 피해 인접한 평행 주차 공간으로 진입합니다.',
            fr: 'Exercice intermédiaire : reculez en diagonale depuis votre voie, en évitant les obstacles, jusqu’à la place parallèle adjacente.',
            de: 'Mittlere Übung: Setzen Sie diagonal aus Ihrer Spur zurück, an Hindernissen vorbei, in den angrenzenden Parallelplatz.'
        },
        tutorial: {
            en: "Tip: First steer RIGHT to swing the trailer's rear into the adjacent lane. Once it's at a good angle, steer LEFT quickly so the cab swings around to follow the trailer, then straighten out as you near the spot.",
            zh: '提示：先向右打方向盘，让挂车尾部斜向右后方切入相邻车道；当挂车进入合适角度后，迅速向左打方向盘，让车头绕过挂车并跟进，最后在靠近车位时将车身拉直。',
            ja: 'ヒント：まずハンドルを右へ切り、トレーラー後部を隣のレーンへ斜めに切り込ませます。適切な角度に達したらすぐに左へ切り、ヘッドがトレーラーを追いかけるように回り込ませ、駐車スペース近くで車体をまっすぐに整えます。',
            ko: '팁: 먼저 핸들을 오른쪽으로 돌려 트레일러 뒤를 인접 차선 쪽으로 보냅니다. 적절한 각도에 도달하면 빠르게 왼쪽으로 돌려 트랙터가 트레일러를 따라 돌게 한 뒤, 주차 공간 근처에서 차체를 곧게 폅니다.',
            fr: "Astuce : tournez d'abord à droite pour envoyer l'arrière de la remorque vers la voie voisine. Une fois l'angle correct, tournez vite à gauche pour que le tracteur contourne et suive la remorque, puis redressez en approchant de la place.",
            de: 'Tipp: Zunächst nach rechts lenken, damit das Heck des Anhängers in die Nebenspur schwenkt. Sobald der Winkel passt, schnell nach links einschlagen, damit die Zugmaschine herumzieht und folgt — am Ende vor der Box gerade ausrichten.'
        },
        initialState: {
            x: 480,
            y: 170,
            thetaC: 0,
            thetaT: 0
        },
        parkingSpot: {
            x: 130,
            y: 280,
            width: 36,
            length: 125,
            angle: 0
        },
        obstacles: [
            { x: 300, y: 110, width: 8, length: 600, angle: 0, type: 'wall' },
            { x: 300, y: 340, width: 8, length: 600, angle: 0, type: 'wall' },
            { x: 320, y: 225, width: 20, length: 20, angle: 0, type: 'cone' },
            { x: 320, y: 280, width: 20, length: 20, angle: 0, type: 'cone' }
        ]
    },
    {
        id: 4,
        name: {
            en: 'Parallel Parking',
            zh: '侧方停车',
            ja: '縦列駐車',
            ko: '평행 주차',
            fr: 'Stationnement en créneau',
            de: 'Längsparken'
        },
        description: {
            en: 'Practical drill: parallel park the semi-trailer at the curb between two obstacle vehicles.',
            zh: '实用训练：将半挂车平行停入前后都有障碍车的路边车位中。',
            ja: '実用練習：前後に障害車両のある縦列スペースにセミトレーラーを駐車します。',
            ko: '실전 훈련: 앞뒤에 장애물 차량이 있는 도로변 공간에 세미트레일러를 평행 주차합니다.',
            fr: 'Exercice pratique : créneau d’un semi-remorque entre deux véhicules le long du trottoir.',
            de: 'Praxisübung: Sattelschlepper am Bordstein zwischen zwei Fahrzeugen längs einparken.'
        },
        tutorial: {
            en: "Tip: Drive past the spot, then reverse — first steer right, and once the trailer's midsection sits at ~45° to the front car, steer left so the cab clears the front car while the trailer cuts into the spot. Then shuffle forward and back until you're parallel to the curb.",
            zh: '提示：平行驶过车位，倒车时先向右打方向，当挂车中段与前车尾呈45度时，向左打方向让车头避开前车，同时挂车切入车位。最后在狭窄空间内多次前后揉库，直到靠边平行对齐。',
            ja: 'ヒント：駐車スペースを通り過ぎてから後退します。最初に右へハンドルを切り、トレーラー中央部が前方車に対して約 45 度になったら左へ切り、ヘッドが前車を避けながらトレーラーをスペースに入れます。最後は狭いスペースで前後に切り返しながら、車体を縁石と平行に整えます。',
            ko: '팁: 주차 공간을 지나친 뒤 후진을 시작합니다. 먼저 오른쪽으로 핸들을 돌리고, 트레일러 중앙이 앞차에 대해 약 45도가 되면 왼쪽으로 돌려 트랙터가 앞차를 피하는 동안 트레일러를 공간으로 밀어 넣습니다. 마지막으로 좁은 공간에서 앞뒤로 미세 조정하며 연석과 평행을 맞춥니다.',
            fr: "Astuce : dépassez la place puis enclenchez la marche arrière — braquez d'abord à droite, et quand le milieu de la remorque atteint ~45° par rapport au véhicule avant, braquez à gauche pour que la cabine évite ce dernier tandis que la remorque s'engage. Terminez par de petits va-et-vient jusqu'à être parallèle au trottoir.",
            de: 'Tipp: An der Lücke vorbeifahren, dann rückwärts — zuerst rechts einschlagen; sobald die Mitte des Anhängers etwa 45° zum vorderen Fahrzeug steht, links einschlagen, damit die Zugmaschine vorbeischwenkt und der Anhänger in die Lücke gleitet. Zum Schluss vor- und zurücksetzen, bis das Gespann parallel zum Bordstein steht.'
        },
        initialState: {
            x: 460,
            y: 170,
            thetaC: 0,
            thetaT: 0
        },
        parkingSpot: {
            x: 280,
            y: 280,
            width: 36,
            length: 150,
            angle: 0
        },
        obstacles: [
            { x: 300, y: 110, width: 8, length: 600, angle: 0, type: 'wall' },
            { x: 130, y: 280, width: 32, length: 110, angle: 0, type: 'wall' },
            { x: 430, y: 280, width: 32, length: 110, angle: 0, type: 'wall' },
            { x: 280, y: 310, width: 8, length: 180, angle: 0, type: 'wall' }
        ]
    },
    {
        id: 5,
        randomSpot: true,   // 沙盒：每次加载关卡随机化车位位置 + 角度
        name: {
            en: 'Free Sandbox',
            zh: '自由练习沙盒',
            ja: '自由練習モード',
            ko: '자유 연습 샌드박스',
            fr: 'Bac à sable libre',
            de: 'Freier Übungsmodus'
        },
        description: {
            en: 'Free mode: drive freely in a wide-open area with no crash penalty — try wide-angle reverses to get a feel for the rig.',
            zh: '自由模式：在宽敞的场地内自由驾驶，没有碰撞惩罚，可随意尝试各种大角度倒车。',
            ja: 'フリーモード：広いエリアで自由に運転できます。衝突ペナルティなしで、大角度のバックなど色々試せます。',
            ko: '자유 모드: 넓은 공간에서 자유롭게 운전합니다. 충돌 페널티가 없으며 큰 각도의 후진을 마음껏 시도할 수 있습니다.',
            fr: 'Mode libre : conduisez librement dans un grand espace, sans pénalité de collision — essayez des manœuvres à grand angle.',
            de: 'Freier Modus: Fahren Sie in einem weiten Bereich ohne Kollisionsstrafe — probieren Sie ruhig große Lenkwinkel und Manöver aus.'
        },
        tutorial: {
            en: "Drive freely to get used to how the trailer follows. Toggle the path overlay any time and watch how the cab's steering changes the trailer's hitch angle.",
            zh: '你可以随意行驶，熟悉挂车的随动反馈。在这个关卡中，你可以随时开关轨迹辅助线，并观察车头转向与挂车折角的变化规律。',
            ja: '自由に走行してトレーラーの追従感覚に慣れましょう。軌跡ガイドはいつでもオン／オフでき、ハンドル操作とトレーラーの折れ角の関係を観察できます。',
            ko: '자유롭게 주행하며 트레일러의 추종 감각을 익혀 보세요. 궤적 가이드는 언제든지 켜고 끌 수 있으며, 핸들 조작과 트레일러 굴절각의 관계를 관찰할 수 있습니다.',
            fr: "Roulez librement pour vous habituer au comportement de la remorque. Activez/désactivez le tracé à tout moment et observez l'effet du braquage de la cabine sur l'angle de pivot.",
            de: 'Fahren Sie frei, um das Folgeverhalten des Anhängers kennenzulernen. Spurlinien lassen sich jederzeit ein-/ausblenden — beobachten Sie, wie das Lenken der Zugmaschine den Knickwinkel verändert.'
        },
        initialState: {
            x: 350,
            y: 225,
            thetaC: 0,
            thetaT: 0
        },
        parkingSpot: {
            x: 130,
            y: 225,
            width: 36,
            length: 125,
            angle: 0
        },
        obstacles: [
            { x: 400, y: 20, width: 8, length: 800, angle: 0, type: 'wall' },
            { x: 400, y: 430, width: 8, length: 800, angle: 0, type: 'wall' },
            { x: 20, y: 225, width: 8, length: 450, angle: Math.PI/2, type: 'wall' },
            { x: 780, y: 225, width: 8, length: 450, angle: Math.PI/2, type: 'wall' }
        ]
    }
];
