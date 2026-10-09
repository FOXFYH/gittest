/**
 * GradeSystem - 通用评级系统
 *
 * 移植说明：
 * 1. 在 HTML 中引入本文件：<script src="grade-system.js"></script>
 * 2. 全局对象 GradeSystem 可用
 * 3. 调用 GradeSystem.calculate(accuracy, maxStreak, avgTime, config) 获取评级
 * 4. config 可自定义各等级阈值，不传则使用默认值
 *
 * 评级规则：
 * - 从 SSS 到 D 共7个等级
 * - 需同时满足正确率和连击数两个维度
 * - 每个等级有一个分数加成区间 [bonusLow, bonusHigh]
 * - 加成值在区间内随机取值
 *
 * 返回值：{ grade: 'SSS', bonus: 35.7 }
 */

var GradeSystem = (function () {

    // 默认配置
    var DEFAULT_CONFIG = {
        sssAcc: 97,       // SSS 最低正确率
        sssStreak: 15,    // SSS 最低连击
        maxBonus: 40      // SSS 最高加成百分比
    };

    /**
     * 计算评级
     * @param {number} accuracy - 正确率 0~100
     * @param {number} maxStreak - 最大连击数
     * @param {number} avgTime - 平均每题用时（秒），暂未使用
     * @param {Object} [config] - 自定义配置
     * @param {number} [config.sssAcc=97] - SSS最低正确率
     * @param {number} [config.sssStreak=15] - SSS最低连击
     * @param {number} [config.maxBonus=40] - 最高加成百分比
     * @returns {{ grade: string, bonus: number }}
     */
    function calculate(accuracy, maxStreak, avgTime, config) {
        var c = config || {};
        var sssAcc = c.sssAcc || DEFAULT_CONFIG.sssAcc;
        var sssStreak = c.sssStreak || DEFAULT_CONFIG.sssStreak;
        var maxBonus = c.maxBonus || DEFAULT_CONFIG.maxBonus;
        var step = Math.round(maxBonus / 7 * 10) / 10;

        var GRADES = [
            { grade: 'SSS', minAcc: sssAcc, minStreak: sssStreak, bonusHigh: maxBonus, bonusLow: maxBonus - step },
            { grade: 'SS', minAcc: Math.max(80, sssAcc - 7), minStreak: Math.max(5, sssStreak - 5), bonusHigh: maxBonus - step, bonusLow: maxBonus - step * 2 },
            { grade: 'S', minAcc: Math.max(70, sssAcc - 17), minStreak: Math.max(3, sssStreak - 7), bonusHigh: maxBonus - step * 2, bonusLow: maxBonus - step * 3 },
            { grade: 'A', minAcc: 70, minStreak: 5, bonusHigh: maxBonus - step * 3, bonusLow: maxBonus - step * 4 },
            { grade: 'B', minAcc: 60, minStreak: 3, bonusHigh: maxBonus - step * 4, bonusLow: maxBonus - step * 5 },
            { grade: 'C', minAcc: 40, minStreak: 0, bonusHigh: maxBonus - step * 5, bonusLow: maxBonus - step * 6 },
            { grade: 'D', minAcc: 0, minStreak: 0, bonusHigh: Math.max(5, maxBonus - step * 6), bonusLow: 0 }
        ];

        for (var i = 0; i < GRADES.length; i++) {
            var g = GRADES[i];
            if (accuracy >= g.minAcc && maxStreak >= g.minStreak) {
                var bonus = g.bonusLow + Math.random() * (g.bonusHigh - g.bonusLow);
                bonus = Math.round(bonus * 10) / 10;
                return { grade: g.grade, bonus: bonus };
            }
        }
        return { grade: 'D', bonus: 0 };
    }

    /**
     * 获取等级列表（含阈值信息），用于UI展示
     * @param {Object} [config] - 自定义配置
     * @returns {Array}
     */
    function getGradeList(config) {
        var c = config || {};
        var sssAcc = c.sssAcc || DEFAULT_CONFIG.sssAcc;
        var sssStreak = c.sssStreak || DEFAULT_CONFIG.sssStreak;
        var maxBonus = c.maxBonus || DEFAULT_CONFIG.maxBonus;
        var step = Math.round(maxBonus / 7 * 10) / 10;

        return [
            { grade: 'SSS', minAcc: sssAcc, minStreak: sssStreak, bonusRange: (maxBonus - step) + '~' + maxBonus + '%' },
            { grade: 'SS', minAcc: Math.max(80, sssAcc - 7), minStreak: Math.max(5, sssStreak - 5), bonusRange: (maxBonus - step * 2) + '~' + (maxBonus - step) + '%' },
            { grade: 'S', minAcc: Math.max(70, sssAcc - 17), minStreak: Math.max(3, sssStreak - 7), bonusRange: (maxBonus - step * 3) + '~' + (maxBonus - step * 2) + '%' },
            { grade: 'A', minAcc: 70, minStreak: 5, bonusRange: (maxBonus - step * 4) + '~' + (maxBonus - step * 3) + '%' },
            { grade: 'B', minAcc: 60, minStreak: 3, bonusRange: (maxBonus - step * 5) + '~' + (maxBonus - step * 4) + '%' },
            { grade: 'C', minAcc: 40, minStreak: 0, bonusRange: (maxBonus - step * 6) + '~' + (maxBonus - step * 5) + '%' },
            { grade: 'D', minAcc: 0, minStreak: 0, bonusRange: '0~' + Math.max(5, maxBonus - step * 6) + '%' }
        ];
    }

    return {
        calculate: calculate,
        getGradeList: getGradeList,
        DEFAULT_CONFIG: DEFAULT_CONFIG
    };

})();
