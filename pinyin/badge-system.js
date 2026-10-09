/**
 * BadgeSystem - 通用勋章/成就系统
 *
 * 移植说明：
 * 1. 在 HTML 中引入本文件：<script src="badge-system.js"></script>
 * 2. 全局对象 BadgeSystem 可用
 * 3. 调用 BadgeSystem.checkBadges(sessionStats, studentData) 获取本场所获奖章
 * 4. 调用 BadgeSystem.renderBadges(badgesData, containerEl) 渲染勋章墙
 * 5. 自定义勋章：修改 BADGE_DEFS 和 CUMULATIVE_BADGE_DEFS 数组
 *
 * 数据结构：
 * - sessionStats: 单场数据 { accuracy, maxStreak, avgTime, difficulty, ... }
 * - studentData:  累计数据 { sessions, totalPoints, badges: {}, easyCompleted, ... }
 * - badges 存储格式：{ badgeId: count, ... }  count为获得次数
 */

var BadgeSystem = (function () {

    // ===== 单场勋章定义 =====
    // check(sessionStats) → boolean
    // prob: 获得概率 0~1，1表示必定获得
    var BADGE_DEFS = [
        { id: 'perfect', name: '完美无瑕', icon: '💎', desc: '单场100%正确率', check: function (s) { return s.accuracy === 100; }, prob: 0.7 },
        { id: 'streak5', name: '五连绝世', icon: '🔥', desc: '连续答对5题', check: function (s) { return s.maxStreak >= 5; }, prob: 0.8 },
        { id: 'streak10', name: '十全十美', icon: '🌟', desc: '连续答对10题', check: function (s) { return s.maxStreak >= 10; }, prob: 0.6 },
        { id: 'streak20', name: '不可阻挡', icon: '⚡', desc: '连续答对20题', check: function (s) { return s.maxStreak >= 20; }, prob: 0.4 },
        { id: 'streak30', name: '神之一手', icon: '👑', desc: '连续答对27题(全场连对)', check: function (s) { return s.maxStreak >= 27; }, prob: 0.3 },
        { id: 'speed', name: '闪电快手', icon: '⚡', desc: '平均每题用时<5秒', check: function (s) { return s.avgTime > 0 && s.avgTime < 5; }, prob: 0.5 },
        { id: 'corrector', name: '知错就改', icon: '🔄', desc: '答错后连续答对≥15题', check: function (s) { return s.earlyErrors > 0 && s.maxStreak >= 15; }, prob: 0.6 },
        { id: 'high_acc', name: '稳如磐石', icon: '🛡️', desc: '正确率≥97%', check: function (s) { return s.accuracy >= 97 && s.accuracy < 100; }, prob: 0.6 },
        { id: 'comeback', name: '逆风翻盘', icon: '🏆', desc: '前5题错≥2题但最终正确率≥90%', check: function (s) { return s.earlyErrors >= 2 && s.accuracy >= 90; }, prob: 0.4 },
        { id: 'brave', name: '勇者无惧', icon: '🗡️', desc: '困难模式下正确率≥95%', check: function (s) { return s.difficulty === 'hard' && s.accuracy >= 95; }, prob: 0.5 }
    ];

    // ===== 积累型勋章定义 =====
    // check(studentData) → boolean
    // 积累型勋章 prob 固定为 1.0（达到条件必定获得）
    var CUMULATIVE_BADGE_DEFS = [
        { id: 'pioneer', name: '初出茅庐', icon: '🌱', desc: '完成1场比赛', check: function (st) { return st.sessions >= 1; }, prob: 1.0 },
        { id: 'persistent', name: '锲而不舍', icon: '💪', desc: '累计完成10场比赛', check: function (st) { return st.sessions >= 10; }, prob: 1.0 },
        { id: 'devoted', name: '百炼成钢', icon: '⚒️', desc: '累计完成50场比赛', check: function (st) { return st.sessions >= 50; }, prob: 1.0 },
        { id: 'legend', name: '千锤百炼', icon: '🏔️', desc: '累计完成100场比赛', check: function (st) { return st.sessions >= 100; }, prob: 1.0 },
        { id: 'easy_clear', name: '踏歌而行', icon: '🌸', desc: '简单模式通关一个学期', check: function (st) { return (st.easyCompleted || 0) >= 1; }, prob: 1.0 },
        { id: 'medium_clear', name: '烈火淬金', icon: '🔥', desc: '中等模式通关一个学期', check: function (st) { return (st.mediumCompleted || 0) >= 1; }, prob: 1.0 },
        { id: 'hard_clear', name: '登峰造极', icon: '👑', desc: '困难模式通关一个学期', check: function (st) { return (st.hardCompleted || 0) >= 1; }, prob: 1.0 },
        { id: 'points_1k', name: '小有所成', icon: '✨', desc: '累计积分达到1000', check: function (st) { return st.totalPoints >= 1000; }, prob: 1.0 },
        { id: 'points_5k', name: '学富五车', icon: '📚', desc: '累计积分达到5000', check: function (st) { return st.totalPoints >= 5000; }, prob: 1.0 },
        { id: 'points_20k', name: '满腹经纶', icon: '🎓', desc: '累计积分达到20000', check: function (st) { return st.totalPoints >= 20000; }, prob: 1.0 },
        { id: 'points_50k', name: '博古通今', icon: '🌟', desc: '累计积分达到50000', check: function (st) { return st.totalPoints >= 50000; }, prob: 1.0 }
    ];

    /**
     * 检查本场所获奖章
     * @param {Object} sessionStats - 单场数据
     * @param {Object} studentData - 累计数据（会被修改：写入badges和难度通关计数）
     * @returns {Array} 本场获得的勋章定义数组
     */
    function checkBadges(sessionStats, studentData) {
        var earned = [];
        var badges = studentData.badges || {};

        // 单场勋章（概率触发）
        BADGE_DEFS.forEach(function (def) {
            if (def.check(sessionStats)) {
                if (Math.random() < def.prob) {
                    badges[def.id] = (badges[def.id] || 0) + 1;
                    earned.push(def);
                }
            }
        });

        // 积累型勋章：通关时计数
        if (sessionStats.phaseCompleted === 'exam') {
            var diffKey = sessionStats.difficulty + 'Completed';
            studentData[diffKey] = (studentData[diffKey] || 0) + 1;
        }

        // 积累型勋章（达到条件必定获得，不重复发放）
        CUMULATIVE_BADGE_DEFS.forEach(function (def) {
            if (!badges[def.id] && def.check(studentData)) {
                badges[def.id] = 1;
                earned.push(def);
            }
        });

        studentData.badges = badges;
        return earned;
    }

    /**
     * 渲染勋章墙
     * @param {Object} badgesData - { badgeId: count, ... }
     * @param {HTMLElement} containerEl - 容器元素
     * @param {Object} [options] - 配置
     * @param {string} [options.cardClass='badge-card'] - 卡片CSS类名
     * @param {string} [options.earnedClass='earned'] - 已获得CSS类名
     */
    function renderBadges(badgesData, containerEl, options) {
        var opts = options || {};
        var cardClass = opts.cardClass || 'badge-card';
        var earnedClass = opts.earnedClass || 'earned';
        containerEl.innerHTML = '';

        var allDefs = BADGE_DEFS.concat(CUMULATIVE_BADGE_DEFS);
        allDefs.forEach(function (def) {
            var count = badgesData[def.id] || 0;
            var card = document.createElement('div');
            card.className = cardClass + (count > 0 ? ' ' + earnedClass : '');
            card.innerHTML = '<div class="badge-icon-lg">' + def.icon + '</div>' +
                '<div class="badge-title">' + def.name + '</div>' +
                (count > 0 ? '<div class="badge-count">x' + count + '</div>' : '') +
                '<div class="badge-desc">' + def.desc + '</div>';
            containerEl.appendChild(card);
        });
    }

    /**
     * 获取所有勋章定义（单场+积累型）
     * @returns {Array}
     */
    function getAllDefs() {
        return BADGE_DEFS.concat(CUMULATIVE_BADGE_DEFS);
    }

    /**
     * 获取单场勋章定义
     * @returns {Array}
     */
    function getSessionDefs() {
        return BADGE_DEFS.slice();
    }

    /**
     * 获取积累型勋章定义
     * @returns {Array}
     */
    function getCumulativeDefs() {
        return CUMULATIVE_BADGE_DEFS.slice();
    }

    // 公开接口
    return {
        checkBadges: checkBadges,
        renderBadges: renderBadges,
        getAllDefs: getAllDefs,
        getSessionDefs: getSessionDefs,
        getCumulativeDefs: getCumulativeDefs,
        // 暴露定义数组，方便外部自定义
        BADGE_DEFS: BADGE_DEFS,
        CUMULATIVE_BADGE_DEFS: CUMULATIVE_BADGE_DEFS
    };

})();
