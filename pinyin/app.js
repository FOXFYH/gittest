(function () {
    'use strict';
    var App = window.App = {};
    // 用户手动选择的学期（点击学期卡片时设置，优先于 getCurrentSemester）
    App.selectedSemesterId = null;

    // ===== 工具函数 =====
    function shuffle(arr) {
        var a = arr.slice();
        for (var i = a.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var t = a[i]; a[i] = a[j]; a[j] = t;
        }
        return a;
    }

    // 按概率加权随机选取n个字（不重复）
    function weightedPick(chars, n) {
        if (!chars || chars.length === 0) return [];
        n = Math.min(n, chars.length);
        var pool = chars.slice();
        var result = [];
        for (var i = 0; i < n; i++) {
            var totalWeight = 0;
            for (var k = 0; k < pool.length; k++) totalWeight += (pool[k].prob || 10);
            var r = Math.random() * totalWeight;
            var acc = 0;
            for (var k = 0; k < pool.length; k++) {
                acc += (pool[k].prob || 10);
                if (acc >= r) {
                    result.push(pool.splice(k, 1)[0]);
                    break;
                }
            }
        }
        return result;
    }

    // ===== 等级系统 =====
    // 9大阶 × 3小阶(初级/中级/高级) = 27级，线性增长，每级2000分
    // 学完全部12学期成绩较好者约54000分，可达最高级
    var LEVELS = [
        { lv: 1,  name: '初级学徒', minPts: 0 },
        { lv: 2,  name: '中级学徒', minPts: 2000 },
        { lv: 3,  name: '高级学徒', minPts: 4000 },
        { lv: 4,  name: '初级弟子', minPts: 6000 },
        { lv: 5,  name: '中级弟子', minPts: 8000 },
        { lv: 6,  name: '高级弟子', minPts: 10000 },
        { lv: 7,  name: '初级门生', minPts: 12000 },
        { lv: 8,  name: '中级门生', minPts: 14000 },
        { lv: 9,  name: '高级门生', minPts: 16000 },
        { lv: 10, name: '初级达人', minPts: 18000 },
        { lv: 11, name: '中级达人', minPts: 20000 },
        { lv: 12, name: '高级达人', minPts: 22000 },
        { lv: 13, name: '初级高手', minPts: 24000 },
        { lv: 14, name: '中级高手', minPts: 26000 },
        { lv: 15, name: '高级高手', minPts: 28000 },
        { lv: 16, name: '初级精英', minPts: 30000 },
        { lv: 17, name: '中级精英', minPts: 32000 },
        { lv: 18, name: '高级精英', minPts: 34000 },
        { lv: 19, name: '初级大师', minPts: 36000 },
        { lv: 20, name: '中级大师', minPts: 38000 },
        { lv: 21, name: '高级大师', minPts: 40000 },
        { lv: 22, name: '初级宗师', minPts: 42000 },
        { lv: 23, name: '中级宗师', minPts: 44000 },
        { lv: 24, name: '高级宗师', minPts: 46000 },
        { lv: 25, name: '初级圣者', minPts: 48000 },
        { lv: 26, name: '中级圣者', minPts: 50000 },
        { lv: 27, name: '高级圣者', minPts: 52000 }
    ];

    function getLevel(pts) {
        var result = LEVELS[0];
        for (var i = LEVELS.length - 1; i >= 0; i--) {
            if (pts >= LEVELS[i].minPts) { result = LEVELS[i]; break; }
        }
        return result;
    }

    function getNextLevel(pts) {
        var cur = getLevel(pts);
        for (var i = 0; i < LEVELS.length; i++) {
            if (LEVELS[i].lv === cur.lv + 1) return LEVELS[i];
        }
        return null;
    }

    // ===== 勋章系统 & 评级系统 =====
    // 已独立为 badge-system.js 和 grade-system.js
    // 此处通过 BadgeSystem / GradeSystem 全局对象调用
    var BADGE_DEFS = BadgeSystem.BADGE_DEFS;
    var CUMULATIVE_BADGE_DEFS = BadgeSystem.CUMULATIVE_BADGE_DEFS;

    // ===== 评级系统 =====
    // 已独立为 grade-system.js，此处包装为项目内函数
    function calculateGrade(accuracy, maxStreak, avgTime) {
        var s = App.Storage.getSettings();
        return GradeSystem.calculate(accuracy, maxStreak, avgTime, {
            sssAcc: s.sssAcc || 97,
            sssStreak: s.sssStreak || 15,
            maxBonus: s.maxBonus || 40
        });
    }

    // ===== 难度配置 =====
    var DIFFICULTY = {
        easy: {
            name: '简单', baseScore: 10, timer: 30,
            initialCount: 5, medialCount: 5, finalCount: 5, wholeCount: 5
        },
        medium: {
            name: '中等', baseScore: 15, timer: 20,
            initialCount: 10, medialCount: 10, finalCount: 10, wholeCount: 10
        },
        hard: {
            name: '困难', baseScore: 20, timer: 12,
            initialCount: 15, medialCount: 15, finalCount: 15, wholeCount: 15
        }
    };

    var CHARS_PER_SESSION = 30;
    var REVIEW_RATIO = 0.3; // 30%复习字
    var TIME_WEIGHT = 0.5; // 时间加成权重50%

    // 从设置中获取动态难度配置
    function getDiffConfig(diff) {
        var s = App.Storage.getSettings();
        var base = DIFFICULTY[diff];
        return {
            name: base.name,
            baseScore: s[diff + 'Score'] || base.baseScore,
            timer: s[diff + 'Timer'] || base.timer,
            initialCount: base.initialCount,
            medialCount: base.medialCount,
            finalCount: base.finalCount,
            wholeCount: base.wholeCount
        };
    }

    // ===== 存储（文件协议版） =====
    var STORAGE_PREFIX = 'PINYINLIANXI_';
    var FILE_INDEX_KEY = STORAGE_PREFIX + 'file_index';
    var MIRROR_FILE_NAME = '★系统设置'; // 镜像文件名，以★开头自动识别
    var MIRROR_FILE_ID_KEY = STORAGE_PREFIX + 'mirror_file_id'; // 本地永久绑定的镜像文件ID
    var TEST_MODE_KEY = STORAGE_PREFIX + 'test_mode'; // 测试模式标志
    var TEST_BACKUP_PREFIX = STORAGE_PREFIX + 'test_backup_'; // 测试模式数据备份前缀

    // 测试模式配置
    var TEST_CONFIG = { charsPerSemester: 4, charsPerSession: 2 };

    // 判断是否处于测试模式
    App.isTestMode = function () {
        return localStorage.getItem(TEST_MODE_KEY) === '1';
    };

    // 生成10位随机文件ID
    function generateFileId() {
        var id = '';
        for (var i = 0; i < 10; i++) id += Math.floor(Math.random() * 10);
        return id;
    }

    // 获取文件索引
    function getFileIndex() {
        try { return JSON.parse(localStorage.getItem(FILE_INDEX_KEY)) || []; }
        catch (e) { return []; }
    }
    // 设置文件索引（按文件名去重）
    function setFileIndex(idx) {
        // 去重：同名只保留最后一条
        var seen = {};
        var deduped = [];
        for (var i = idx.length - 1; i >= 0; i--) {
            if (!seen[idx[i].name]) {
                seen[idx[i].name] = true;
                deduped.unshift(idx[i]);
            }
        }
        localStorage.setItem(FILE_INDEX_KEY, JSON.stringify(deduped));
    }
    // 按文件名查找索引条目
    function findIndexByName(name) {
        var idx = getFileIndex();
        for (var i = 0; i < idx.length; i++) {
            if (idx[i].name === name) return idx[i];
        }
        return null;
    }
    // 按ID查找索引条目
    function findIndexById(id) {
        var idx = getFileIndex();
        for (var i = 0; i < idx.length; i++) {
            if (idx[i].id === id) return idx[i];
        }
        return null;
    }
    // 读取文件data
    function readFileData(id) {
        try {
            var raw = localStorage.getItem(STORAGE_PREFIX + 'file_id_' + id);
            if (!raw) return null;
            var obj = JSON.parse(raw);
            return obj.data || null;
        } catch (e) { return null; }
    }
    // 写入文件data（自动维护版本号）
    function writeFileData(id, data) {
        var key = STORAGE_PREFIX + 'file_id_' + id;
        var raw = localStorage.getItem(key);
        var obj = raw ? JSON.parse(raw) : {};
        var oldData = obj.data || '';
        var newData = typeof data === 'string' ? data : JSON.stringify(data);
        obj.data = newData;
        obj.view = obj.view || null;
        localStorage.setItem(key, JSON.stringify(obj));
        // 版本号+1（仅内容变化时）
        if (oldData !== newData) {
            var idx = getFileIndex();
            for (var i = 0; i < idx.length; i++) {
                if (idx[i].id === id) {
                    idx[i].version = (idx[i].version || 0) + 1;
                    idx[i].lastEditTime = new Date().toLocaleString('zh-CN');
                    idx[i].contentLength = newData.length;
                    break;
                }
            }
            setFileIndex(idx);
        }
    }
    // 创建新文件（返回id）
    function createFile(name, data, folder) {
        // 检查是否已存在同名文件
        var existing = findIndexByName(name);
        if (existing) {
            writeFileData(existing.id, data);
            return existing.id;
        }
        var id = generateFileId();
        var now = new Date().toLocaleString('zh-CN');
        var contentStr = typeof data === 'string' ? data : JSON.stringify(data);
        var entry = {
            name: name,
            id: id,
            version: 1,
            lastSyncVersion: 0,
            isNewFile: true,
            folder: folder || '',
            owner: '',
            createTime: now,
            lastUploadTime: '',
            lastEditTime: now,
            contentLength: contentStr.length
        };
        var idx = getFileIndex();
        idx.push(entry);
        setFileIndex(idx);
        writeFileData(id, data);
        return id;
    }
    // 获取学期文件名
    function getSemesterFileName(semesterId) {
        var sem = null;
        for (var i = 0; i < PinyinData.semesters.length; i++) {
            if (PinyinData.semesters[i].id === semesterId) { sem = PinyinData.semesters[i]; break; }
        }
        return sem ? sem.name : semesterId;
    }

    App.Storage = {
        // --- 底层文件协议操作 ---
        // 获取镜像文件的全部数据
        _getMirrorData: function () {
            var entry = findIndexByName(MIRROR_FILE_NAME);
            if (!entry) return null;
            var raw = readFileData(entry.id);
            if (!raw) return null;
            try { return JSON.parse(raw); } catch (e) { return null; }
        },
        // 写入镜像文件
        _setMirrorData: function (data) {
            var entry = findIndexByName(MIRROR_FILE_NAME);
            if (entry) {
                writeFileData(entry.id, JSON.stringify(data));
            } else {
                var newId = createFile(MIRROR_FILE_NAME, JSON.stringify(data));
                this._bindMirrorFileId(newId);
            }
        },
        // 获取某学期文件的全部数据
        _getSemesterData: function (semesterId) {
            var fileName = getSemesterFileName(semesterId);
            var entry = findIndexByName(fileName);
            if (!entry) return null;
            var raw = readFileData(entry.id);
            if (!raw) return null;
            try { return JSON.parse(raw); } catch (e) { return null; }
        },
        // 写入某学期文件
        _setSemesterData: function (semesterId, data) {
            var fileName = getSemesterFileName(semesterId);
            var entry = findIndexByName(fileName);
            if (entry) {
                writeFileData(entry.id, JSON.stringify(data));
            } else {
                var newId = createFile(fileName, JSON.stringify(data));
                this.setSemesterFileId(semesterId, newId);
            }
        },
        // 确保镜像文件存在
        _ensureMirrorFile: function () {
            var entry = findIndexByName(MIRROR_FILE_NAME);
            if (!entry) {
                var data = {
                    student: { name: '', totalPoints: 0, totalCorrect: 0, totalCount: 0, sessions: 0, badges: {} },
                    settings: {
                        penaltyRate: 100, soundEnabled: true, syncEnabled: true, charsPerSession: 30, reviewRatio: 30,
                        easyTimer: 30, mediumTimer: 20, hardTimer: 12, easyScore: 10, mediumScore: 15, hardScore: 20,
                        timeWeight: 50, sssAcc: 97, sssStreak: 15, maxBonus: 40, autoSaveInterval: 1,
                        feedbackFontSize: 28, pinyinDisplaySize: 56
                    },
                    currentSemesterId: '',
                    history: [],
                    optionFontSize: 20,
                    examProgress: null,
                    unlockedDifficulties: ['easy'],
                    semesterFileIds: {} // 12个学期文件ID绑定：{ '1a': '8090761640', '1b': '', ... }
                };
                var newId = createFile(MIRROR_FILE_NAME, JSON.stringify(data));
                // 创建后立即绑定镜像文件ID到本地永久存储
                this._bindMirrorFileId(newId);
            } else {
                // 已存在 → 绑定ID到本地永久存储
                this._bindMirrorFileId(entry.id);
                // 兼容旧数据：补充 semesterFileIds 字段
                var mirror = this._getMirrorData();
                if (mirror && !mirror.semesterFileIds) {
                    mirror.semesterFileIds = {};
                    this._setMirrorData(mirror);
                }
            }
        },
        // 确保某学期文件存在
        _ensureSemesterFile: function (semesterId) {
            var fileName = getSemesterFileName(semesterId);

            // 1. 先检查★系统设置里是否已绑定该学期的文件ID
            var boundId = this.getSemesterFileId(semesterId);
            if (boundId) {
                // 已绑定ID → 认死理，只认这个ID
                var entryById = findIndexById(boundId);
                if (entryById) return; // 本地有绑定的文件 → 不新建
                // 本地没有绑定的文件 → 不新建，等同步下载
                console.log('[学期文件] ' + semesterId + ' 已绑定ID=' + boundId + '，本地缺失，等待同步');
                return;
            }

            // 2. 未绑定ID → 检查本地是否已有同名文件
            var entry = findIndexByName(fileName);
            if (entry) {
                // 本地已有同名文件 → 把它的ID绑定到★系统设置
                this.setSemesterFileId(semesterId, entry.id);
                console.log('[学期文件] ' + semesterId + ' 绑定已有文件ID=' + entry.id);
                return;
            }

            // 3. 本地没有，且未绑定 → 按需创建（只有当前/活跃学期才创建）
            var curSem = App.Semester.getActiveSemester();
            if (curSem && curSem.id === semesterId) {
                var data = {
                    semesterProgress: { phase: 'assessment', completed: false, assessmentDone: false, completionDone: false, examDone: false, sessions: 0, halfScore: false },
                    charData: {}
                };
                var newId = createFile(fileName, JSON.stringify(data));
                // 创建后立即绑定ID到★系统设置
                this.setSemesterFileId(semesterId, newId);
                console.log('[学期文件] ' + semesterId + ' 新建并绑定ID=' + newId);
            }
            // 非当前学期不自动创建文件，等用户切换到该学期时再创建
        },
        // 检查云端是否已有某文件（由FileSync调用）
        // 返回值：true=已确认云端有，false=已确认云端无，null=未确认（联网失败或未查询）
        _cloudHasFile: function (fileName) {
            if (!this._cloudFileConfirmed || !this._cloudFileConfirmed[fileName]) {
                return null; // 未确认，不能判定
            }
            return this._cloudFileCache && !!this._cloudFileCache[fileName] || false;
        },
        _cloudFileCache: {},
        _cloudFileConfirmed: {}, // fileName → true(已确认云端有无)

        // --- 镜像文件ID绑定（本地永久存储，认死理） ---
        // 绑定镜像文件ID到本地永久存储
        _bindMirrorFileId: function (id) {
            if (id) localStorage.setItem(MIRROR_FILE_ID_KEY, id);
        },
        // 获取本地永久绑定的镜像文件ID
        getBoundMirrorFileId: function () {
            return localStorage.getItem(MIRROR_FILE_ID_KEY) || '';
        },

        // --- 学期文件ID绑定（存于镜像文件semesterFileIds） ---
        // 获取学期绑定的文件ID
        getSemesterFileId: function (semesterId) {
            var mirror = this._getMirrorData();
            if (!mirror || !mirror.semesterFileIds) return '';
            return mirror.semesterFileIds[semesterId] || '';
        },
        // 设置学期绑定的文件ID（写入★系统设置）
        setSemesterFileId: function (semesterId, id) {
            var mirror = this._getMirrorData() || {};
            if (!mirror.semesterFileIds) mirror.semesterFileIds = {};
            // 已绑定且ID不同 → 拒绝覆盖（认死理）
            if (mirror.semesterFileIds[semesterId] && mirror.semesterFileIds[semesterId] !== id) {
                console.warn('[学期ID绑定] ' + semesterId + ' 已绑定ID=' + mirror.semesterFileIds[semesterId] + '，拒绝覆盖为' + id);
                return false;
            }
            mirror.semesterFileIds[semesterId] = id;
            this._setMirrorData(mirror);
            return true;
        },
        // 检查学期是否已注册（已绑定ID）
        isSemesterRegistered: function (semesterId) {
            return !!this.getSemesterFileId(semesterId);
        },

        // --- 兼容旧API ---
        get: function (k, d) {
            // 旧式直接键值访问，用于过渡期
            try { var v = localStorage.getItem(STORAGE_PREFIX + k); return v ? JSON.parse(v) : d; }
            catch (e) { return d; }
        },
        set: function (k, v) {
            try { localStorage.setItem(STORAGE_PREFIX + k, JSON.stringify(v)); } catch (e) { }
        },

        // 学生数据（存于镜像文件）
        getStudent: function () {
            var mirror = this._getMirrorData();
            if (mirror && mirror.student) return mirror.student;
            return { name: '', totalPoints: 0, totalCorrect: 0, totalCount: 0, sessions: 0, badges: {} };
        },
        setStudent: function (s) {
            var mirror = this._getMirrorData() || {};
            mirror.student = s;
            this._setMirrorData(mirror);
        },

        // 难度解锁（存于镜像文件）
        getUnlockedDifficulties: function () {
            var mirror = this._getMirrorData();
            return mirror ? (mirror.unlockedDifficulties || ['easy']) : ['easy'];
        },
        unlockDifficulty: function (diff) {
            var mirror = this._getMirrorData() || {};
            var list = mirror.unlockedDifficulties || ['easy'];
            if (list.indexOf(diff) === -1) {
                list.push(diff);
                mirror.unlockedDifficulties = list;
                this._setMirrorData(mirror);
            }
        },
        isDifficultyUnlocked: function (diff) {
            var list = this.getUnlockedDifficulties();
            return list.indexOf(diff) !== -1;
        },

        // 学期进度（存于对应学期文件）
        getSemesterProgress: function (semesterId) {
            var semData = this._getSemesterData(semesterId);
            if (semData && semData.semesterProgress) return semData.semesterProgress;
            return {};
        },
        setSemesterProgress: function (p) {
            // p 是 { semesterId: progressObj, ... } 的完整映射
            // 需要逐学期写入各自的文件（只写已存在的文件）
            for (var sid in p) {
                if (p.hasOwnProperty(sid)) {
                    var fileName = getSemesterFileName(sid);
                    var entry = findIndexByName(fileName);
                    if (entry) {
                        var semData = this._getSemesterData(sid) || {};
                        semData.semesterProgress = p[sid];
                        this._setSemesterData(sid, semData);
                    }
                }
            }
        },
        // 设置单个学期的进度
        setSemesterProgressSingle: function (semesterId, progress) {
            this._ensureSemesterFile(semesterId);
            var semData = this._getSemesterData(semesterId) || {};
            semData.semesterProgress = progress;
            this._setSemesterData(semesterId, semData);
        },

        // 字的概率数据（存于对应学期文件）
        getCharData: function () {
            // 返回所有学期的合并数据（兼容旧接口）
            var result = {};
            var semesters = PinyinData.semesters;
            for (var i = 0; i < semesters.length; i++) {
                var semData = this._getSemesterData(semesters[i].id);
                if (semData && semData.charData) {
                    for (var k in semData.charData) {
                        if (semData.charData.hasOwnProperty(k)) {
                            result[k] = semData.charData[k];
                        }
                    }
                }
            }
            return result;
        },
        setCharData: function (d) {
            // d 是 { '1a_一': {...}, ... } 的合并数据，需要按学期拆分写入
            // 只写入已存在的文件，不自动创建新学期文件
            var semesters = PinyinData.semesters;
            for (var i = 0; i < semesters.length; i++) {
                var sid = semesters[i].id;
                var prefix = sid + '_';
                var semCharData = {};
                var hasData = false;
                for (var k in d) {
                    if (d.hasOwnProperty(k) && k.indexOf(prefix) === 0) {
                        semCharData[k] = d[k];
                        hasData = true;
                    }
                }
                if (hasData) {
                    var fileName = getSemesterFileName(sid);
                    var entry = findIndexByName(fileName);
                    if (entry) {
                        var semData = this._getSemesterData(sid) || {};
                        semData.charData = semCharData;
                        this._setSemesterData(sid, semData);
                    }
                }
            }
        },
        // 获取单个学期的字概率数据
        getSemesterCharData: function (semesterId) {
            var semData = this._getSemesterData(semesterId);
            if (semData && semData.charData) return semData.charData;
            return {};
        },
        // 设置单个学期的字概率数据
        setSemesterCharData: function (semesterId, charData) {
            this._ensureSemesterFile(semesterId);
            var semData = this._getSemesterData(semesterId) || {};
            semData.charData = charData;
            this._setSemesterData(semesterId, semData);
        },

        // 设置（存于镜像文件）
        getSettings: function () {
            var mirror = this._getMirrorData();
            if (mirror && mirror.settings) return mirror.settings;
            return {
                penaltyRate: 100, soundEnabled: true, syncEnabled: true, charsPerSession: 30, reviewRatio: 30,
                easyTimer: 30, mediumTimer: 20, hardTimer: 12, easyScore: 10, mediumScore: 15, hardScore: 20,
                timeWeight: 50, sssAcc: 97, sssStreak: 15, maxBonus: 40, autoSaveInterval: 1,
                feedbackFontSize: 28, pinyinDisplaySize: 56
            };
        },
        setSettings: function (s) {
            var mirror = this._getMirrorData() || {};
            mirror.settings = s;
            this._setMirrorData(mirror);
        },

        // 历史记录（存于镜像文件）
        getHistory: function () {
            var mirror = this._getMirrorData();
            if (mirror && mirror.history) return mirror.history;
            return [];
        },
        addHistory: function (h) {
            var mirror = this._getMirrorData() || {};
            if (!mirror.history) mirror.history = [];
            mirror.history.push(h);
            this._setMirrorData(mirror);
        },

        // 当前学期ID（存于镜像文件）
        getCurrentSemesterId: function () {
            var mirror = this._getMirrorData();
            return mirror ? (mirror.currentSemesterId || '') : '';
        },
        setCurrentSemesterId: function (semesterId) {
            var mirror = this._getMirrorData() || {};
            mirror.currentSemesterId = semesterId;
            this._setMirrorData(mirror);
        },

        // 考试中断进度（存于镜像文件）
        getExamProgress: function () {
            var mirror = this._getMirrorData();
            return mirror ? mirror.examProgress : null;
        },
        setExamProgress: function (data) {
            var mirror = this._getMirrorData() || {};
            mirror.examProgress = data;
            this._setMirrorData(mirror);
        },

        // 选项字号（存于镜像文件）
        getOptionFontSize: function () {
            var mirror = this._getMirrorData();
            return mirror ? (mirror.optionFontSize || 20) : 20;
        },
        setOptionFontSize: function (size) {
            var mirror = this._getMirrorData() || {};
            mirror.optionFontSize = size;
            this._setMirrorData(mirror);
        },

        // 初始化所有必要文件
        initFiles: function () {
            this._ensureMirrorFile();
            // 确保当前学期文件存在
            var curSem = App.Semester.getCurrentSemester();
            if (curSem) {
                this._ensureSemesterFile(curSem.id);
            }
        },

        // 从旧格式迁移数据到新格式
        migrateFromOldFormat: function () {
            // 检查是否已有镜像文件
            if (findIndexByName(MIRROR_FILE_NAME)) return; // 已迁移过

            // 读取旧格式的所有数据
            var oldStudent = this.get('student');
            var oldSettings = this.get('settings');
            var oldHistory = this.get('history');
            var oldOptionFontSize = this.get('optionFontSize');
            var oldExamProgress = this.get('examProgress');

            // 构建镜像文件数据
            var mirrorData = {
                student: oldStudent || { name: '', totalPoints: 0, totalCorrect: 0, totalCount: 0, sessions: 0, badges: {} },
                settings: oldSettings || this.getSettings(),
                currentSemesterId: '',
                history: oldHistory || [],
                optionFontSize: oldOptionFontSize || 20,
                examProgress: oldExamProgress || null
            };

            // 迁移学期进度和字概率数据
            var oldSemesterProgress = this.get('semesterProgress') || {};
            var oldCharData = this.get('charData') || {};

            // 按学期拆分并创建学期文件
            var semesters = PinyinData.semesters;
            for (var i = 0; i < semesters.length; i++) {
                var sid = semesters[i].id;
                var prefix = sid + '_';
                var semCharData = {};
                for (var k in oldCharData) {
                    if (oldCharData.hasOwnProperty(k) && k.indexOf(prefix) === 0) {
                        semCharData[k] = oldCharData[k];
                    }
                }
                var semProgress = oldSemesterProgress[sid] || null;
                // 只在有数据时创建学期文件
                if (semProgress || Object.keys(semCharData).length > 0) {
                    var semData = {
                        semesterProgress: semProgress || { phase: 'assessment', completed: false, assessmentDone: false, completionDone: false, examDone: false, sessions: 0, halfScore: false },
                        charData: semCharData
                    };
                    var migratedSemId = createFile(getSemesterFileName(sid), JSON.stringify(semData));
                    // 迁移时也绑定ID
                    this.setSemesterFileId(sid, migratedSemId);
                }
            }

            // 创建镜像文件
            var migratedMirrorId = createFile(MIRROR_FILE_NAME, JSON.stringify(mirrorData));
            // 迁移时也绑定镜像文件ID
            this._bindMirrorFileId(migratedMirrorId);
        }
    };

    // ===== 字概率管理 =====
    App.CharProb = {
        // 获取某个字的概率数据，不存在则初始化
        get: function (semesterId, charStr) {
            var data = App.Storage.getSemesterCharData(semesterId);
            var key = semesterId + '_' + charStr;
            if (!data[key]) {
                // 根据errorLevel设置初始概率
                var charInfo = this.findCharInfo(semesterId, charStr);
                var baseProb = 10;
                if (charInfo) {
                    if (charInfo.errorLevel === 1) baseProb = 20;   // +100%
                    else if (charInfo.errorLevel === 2) baseProb = 30; // +200%
                    else if (charInfo.errorLevel === 3) baseProb = 50; // +400%
                }
                data[key] = { prob: baseProb, wrongCount: 0, baseProb: baseProb,
                    diffProgress: {
                        easy: { tested: false, correctOnce: false },
                        medium: { tested: false, correctOnce: false },
                        hard: { tested: false, correctOnce: false }
                    }
                };
                App.Storage.setSemesterCharData(semesterId, data);
            }
            // 兼容旧数据：迁移 tested/correctOnce 到 diffProgress.easy
            if (!data[key].diffProgress) {
                data[key].diffProgress = {
                    easy: { tested: data[key].tested || false, correctOnce: data[key].correctOnce || false },
                    medium: { tested: false, correctOnce: false },
                    hard: { tested: false, correctOnce: false }
                };
                delete data[key].tested;
                delete data[key].correctOnce;
                App.Storage.setSemesterCharData(semesterId, data);
            }
            return data[key];
        },
        set: function (semesterId, charStr, probData) {
            var data = App.Storage.getSemesterCharData(semesterId);
            var key = semesterId + '_' + charStr;
            data[key] = probData;
            App.Storage.setSemesterCharData(semesterId, data);
        },
        findCharInfo: function (semesterId, charStr) {
            var chars = PinyinData.chars[semesterId];
            if (!chars) return null;
            for (var i = 0; i < chars.length; i++) {
                if (chars[i].char === charStr) return chars[i];
            }
            return null;
        },
        // 答错：概率翻倍（受惩罚概率倍率影响）
        onWrong: function (semesterId, charStr) {
            var pd = this.get(semesterId, charStr);
            var settings = App.Storage.getSettings();
            var penaltyRate = (settings.penaltyRate || 100) / 100;
            pd.prob = Math.round(pd.prob * (1 + penaltyRate));
            pd.wrongCount = (pd.wrongCount || 0) + 1;
            this.set(semesterId, charStr, pd);
        },
        // 答对：概率减少30%，最低不低于baseProb
        onCorrect: function (semesterId, charStr, difficulty) {
            var pd = this.get(semesterId, charStr);
            pd.prob = Math.max(pd.baseProb || 10, Math.round(pd.prob * 0.7));
            pd.diffProgress[difficulty].correctOnce = true;
            this.set(semesterId, charStr, pd);
        },
        // 标记已测试
        markTested: function (semesterId, charStr, difficulty) {
            var pd = this.get(semesterId, charStr);
            pd.diffProgress[difficulty].tested = true;
            this.set(semesterId, charStr, pd);
        },
        // 获取某学期所有字的概率列表（按难度返回tested/correctOnce）
        getSemesterChars: function (semesterId, difficulty) {
            var chars = PinyinData.chars[semesterId];
            if (!chars) return [];
            // 测试模式：每学期只取前 N 个字
            if (App.isTestMode()) {
                chars = chars.slice(0, TEST_CONFIG.charsPerSemester);
            }
            var diff = difficulty || 'easy';
            var result = [];
            for (var i = 0; i < chars.length; i++) {
                var pd = this.get(semesterId, chars[i].char);
                result.push({
                    char: chars[i].char,
                    pinyin: chars[i].pinyin,
                    errorLevel: chars[i].errorLevel,
                    prob: pd.prob,
                    tested: pd.diffProgress[diff].tested,
                    correctOnce: pd.diffProgress[diff].correctOnce,
                    wrongCount: pd.wrongCount,
                    baseProb: pd.baseProb,
                    semesterId: semesterId
                });
            }
            return result;
        }
    };

    // ===== 学期进度管理 =====
    App.Semester = {
        // 获取某学期某难度的进度
        getProgress: function (semesterId, difficulty) {
            var allProgress = App.Storage.getSemesterProgress(semesterId);
            var diff = difficulty || 'easy';
            // 兼容旧数据：如果 allProgress 有 phase 字段（旧格式），迁移到 easy
            if (allProgress && allProgress.phase && !allProgress.easy) {
                allProgress = { easy: allProgress };
            }
            var p = allProgress ? allProgress[diff] : null;
            if (!p) {
                p = { phase: 'assessment', completed: false, assessmentDone: false, completionDone: false, examDone: false, sessions: 0, halfScore: false, lastWrongChars: [] };
            }
            return p;
        },
        setProgress: function (semesterId, difficulty, progress) {
            var allProgress = App.Storage.getSemesterProgress(semesterId) || {};
            // 兼容旧数据
            if (allProgress.phase && !allProgress.easy) {
                allProgress = { easy: allProgress };
            }
            allProgress[difficulty] = progress;
            App.Storage.setSemesterProgressSingle(semesterId, allProgress);
        },
        // 获取当前应该挑战的学期（第一个未完成任意难度的学期）
        // 设计规则：任一难度完成考核即视为已通关，默认前进到下一学期
        getCurrentSemester: function () {
            var semesters = PinyinData.semesters;
            var diffs = ['easy', 'medium', 'hard'];
            for (var i = 0; i < semesters.length; i++) {
                var allProgress = App.Storage.getSemesterProgress(semesters[i].id);
                // 兼容旧数据
                if (allProgress && allProgress.phase && !allProgress.easy) {
                    allProgress = { easy: allProgress };
                }
                // 任一难度完成即视为已通关 → 前进到下一学期
                var hasCompleted = diffs.some(function (d) {
                    return allProgress && allProgress[d] && allProgress[d].completed;
                });
                if (!hasCompleted) return semesters[i];
            }
            // 全部完成，返回最后一个
            return semesters[semesters.length - 1];
        },
        // 获取当前活跃学期（优先用户手动选择的，否则用 getCurrentSemester）
        getActiveSemester: function () {
            if (App.selectedSemesterId) {
                for (var i = 0; i < PinyinData.semesters.length; i++) {
                    if (PinyinData.semesters[i].id === App.selectedSemesterId) {
                        // 检查是否已解锁
                        if (this.isUnlocked(App.selectedSemesterId)) return PinyinData.semesters[i];
                    }
                }
            }
            return this.getCurrentSemester();
        },
        // 获取当前学期的阶段名
        getPhaseName: function (phase) {
            var map = { assessment: '摸底阶段', completion: '补全阶段', exam: '考核阶段', completed: '已完成' };
            return map[phase] || phase;
        },
        // 判断学期是否解锁（上一学期任意难度考核通过即解锁）
        isUnlocked: function (semesterId) {
            var idx = -1;
            for (var i = 0; i < PinyinData.semesters.length; i++) {
                if (PinyinData.semesters[i].id === semesterId) { idx = i; break; }
            }
            if (idx === 0) return true;
            var prevId = PinyinData.semesters[idx - 1].id;
            // 上一学期任意难度完成即解锁
            var diffs = ['easy', 'medium', 'hard'];
            for (var d = 0; d < diffs.length; d++) {
                var p = this.getProgress(prevId, diffs[d]);
                if (p.completed) return true;
            }
            return false;
        },
        // 判断某学期某难度是否解锁
        isDifficultyUnlocked: function (semesterId, difficulty) {
            if (difficulty === 'easy') return true;
            var prevDiff = difficulty === 'medium' ? 'easy' : 'medium';
            var p = this.getProgress(semesterId, prevDiff);
            return p.completed === true;
        },
        // 获取某学期当前应挑战的难度（第一个未完成的已解锁难度）
        getCurrentDifficulty: function (semesterId) {
            var diffs = ['easy', 'medium', 'hard'];
            for (var i = 0; i < diffs.length; i++) {
                if (this.isDifficultyUnlocked(semesterId, diffs[i])) {
                    var p = this.getProgress(semesterId, diffs[i]);
                    if (!p.completed) return diffs[i];
                }
            }
            return 'easy';
        },

        // ===== 重新挑战（已完成的难度可重考，新数据覆盖旧数据）=====
        // 启动重新挑战：备份当前数据 → 重置 progress 和 char data → 标记 active
        startRechallenge: function (semesterId, difficulty) {
            var progress = this.getProgress(semesterId, difficulty);
            if (!progress.completed) {
                App.Toast.show('该难度尚未完成，无法重新挑战', 'warn');
                return false;
            }
            // 备份原 progress 和 char data（深拷贝）
            var backup = {
                semesterId: semesterId,
                difficulty: difficulty,
                progress: JSON.parse(JSON.stringify(progress)),
                charData: JSON.parse(JSON.stringify(App.Storage.getSemesterCharData(semesterId) || {}))
            };
            App.Storage.set('rechallenge_backup', backup);
            App.Storage.set('rechallenge_active', { semesterId: semesterId, difficulty: difficulty });

            // 重置 progress 到初始状态
            var newProgress = {
                phase: 'assessment',
                completed: false,
                assessmentDone: false,
                completionDone: false,
                examDone: false,
                sessions: 0,
                halfScore: false,
                lastWrongChars: []
            };
            this.setProgress(semesterId, difficulty, newProgress);

            // 重置 char data 中该难度的 tested/correctOnce
            var charData = App.Storage.getSemesterCharData(semesterId) || {};
            for (var key in charData) {
                if (charData.hasOwnProperty(key) && charData[key].diffProgress && charData[key].diffProgress[difficulty]) {
                    charData[key].diffProgress[difficulty] = { tested: false, correctOnce: false };
                }
            }
            App.Storage.setSemesterCharData(semesterId, charData);
            return true;
        },

        // 完成重新挑战：清除备份，新数据生效
        finishRechallenge: function () {
            App.Storage.set('rechallenge_backup', null);
            App.Storage.set('rechallenge_active', null);
        },

        // 取消重新挑战：恢复备份数据
        cancelRechallenge: function () {
            var backup = App.Storage.get('rechallenge_backup', null);
            var active = App.Storage.get('rechallenge_active', null);
            if (!backup || !active) return false;
            // 恢复 progress 和 char data（覆盖中途的临时修改）
            this.setProgress(active.semesterId, active.difficulty, backup.progress);
            App.Storage.setSemesterCharData(active.semesterId, backup.charData);
            // 清除标志
            App.Storage.set('rechallenge_backup', null);
            App.Storage.set('rechallenge_active', null);
            return true;
        },

        // 获取当前活跃的重新挑战（无则返回 null）
        getActiveRechallenge: function () {
            return App.Storage.get('rechallenge_active', null);
        }
    };

    // ===== 出题逻辑 =====
    App.QuestionPicker = {
        // 获取当前每场字数
        getCharsPerSession: function () {
            // 测试模式：每场固定 2 字
            if (App.isTestMode()) return TEST_CONFIG.charsPerSession;
            var s = App.Storage.getSettings();
            return s.charsPerSession || 30;
        },
        // 获取复习字比例
        getReviewRatio: function () {
            var s = App.Storage.getSettings();
            return (s.reviewRatio || 30) / 100;
        },
        // 摸底阶段出题
        pickAssessment: function (semesterId, prevWrongChars, difficulty) {
            var allChars = App.CharProb.getSemesterChars(semesterId, difficulty);
            var cps = this.getCharsPerSession();
            var result = [];

            // 上一场错字优先
            if (prevWrongChars && prevWrongChars.length > 0) {
                for (var i = 0; i < prevWrongChars.length && result.length < cps; i++) {
                    var found = this.findInAll(allChars, prevWrongChars[i]);
                    if (found) result.push(found);
                }
            }

            // 未考过的字
            var untested = allChars.filter(function (c) {
                return !c.tested && result.indexOf(c) === -1;
            });
            var shuffled = shuffle(untested);
            for (var i = 0; i < shuffled.length && result.length < cps; i++) {
                result.push(shuffled[i]);
            }

            // 不足，按概率补
            if (result.length < cps) {
                var remaining = allChars.filter(function (c) { return result.indexOf(c) === -1; });
                var extra = weightedPick(remaining, cps - result.length);
                result = result.concat(extra);
            }

            return result.slice(0, cps);
        },

        // 补全阶段出题
        pickCompletion: function (semesterId, difficulty) {
            var allChars = App.CharProb.getSemesterChars(semesterId, difficulty);
            var cps = this.getCharsPerSession();
            var result = [];

            // 优先从未答对过的字
            var neverCorrect = allChars.filter(function (c) { return !c.correctOnce; });
            var shuffled = shuffle(neverCorrect);
            for (var i = 0; i < shuffled.length && result.length < cps; i++) {
                result.push(shuffled[i]);
            }

            // 不足，用高概率字补
            if (result.length < cps) {
                var remaining = allChars.filter(function (c) { return result.indexOf(c) === -1; });
                remaining.sort(function (a, b) { return b.prob - a.prob; });
                for (var i = 0; i < remaining.length && result.length < cps; i++) {
                    result.push(remaining[i]);
                }
            }

            return result.slice(0, cps);
        },

        // 考核阶段出题
        pickExam: function (semesterId, difficulty) {
            var allChars = App.CharProb.getSemesterChars(semesterId, difficulty);
            return weightedPick(allChars, this.getCharsPerSession());
        },

        // 混入复习字（按设置比例来自其他学期）
        addReviewChars: function (questions, currentSemesterId) {
            var semesters = PinyinData.semesters;
            var currentIdx = -1;
            for (var i = 0; i < semesters.length; i++) {
                if (semesters[i].id === currentSemesterId) { currentIdx = i; break; }
            }
            if (currentIdx <= 0) return questions; // 第一个学期不需要混入

            var cps = this.getCharsPerSession();
            var reviewRatio = this.getReviewRatio();
            var reviewCount = Math.round(cps * reviewRatio);
            var mainCount = cps - reviewCount;

            // 从当前学期取mainCount个
            var mainChars = questions.slice(0, mainCount);

            // 从之前学期按概率取reviewCount个
            var prevChars = [];
            for (var i = 0; i < currentIdx; i++) {
                var sc = App.CharProb.getSemesterChars(semesters[i].id);
                prevChars = prevChars.concat(sc);
            }
            var reviewChars = weightedPick(prevChars, reviewCount);

            return shuffle(mainChars.concat(reviewChars));
        },

        findInAll: function (allChars, charStr) {
            for (var i = 0; i < allChars.length; i++) {
                if (allChars[i].char === charStr) return allChars[i];
            }
            return null;
        }
    };

    // ===== 音效 =====
    App.Sound = {
        audioCtx: null, enabled: true,
        init: function () {
            var s = App.Storage.getSettings();
            this.enabled = s.soundEnabled !== false;
        },
        getCtx: function () {
            if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            return this.audioCtx;
        },
        playTone: function (freq, dur, type, vol) {
            if (!this.enabled) return;
            try {
                var ctx = this.getCtx(), osc = ctx.createOscillator(), g = ctx.createGain();
                osc.type = type || 'sine'; osc.frequency.value = freq;
                g.gain.value = (vol || 0.3); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
                osc.connect(g); g.connect(ctx.destination); osc.start(ctx.currentTime); osc.stop(ctx.currentTime + dur);
            } catch (e) { }
        },
        playCorrect: function () { var s = this; s.playTone(880, 0.15, 'sine', 0.3); setTimeout(function () { s.playTone(1175, 0.25, 'sine', 0.3); }, 120); },
        playWrong: function () { this.playTone(200, 0.4, 'sawtooth', 0.2); },
        playClick: function () { this.playTone(800, 0.08, 'square', 0.15); },
        playStepCorrect: function () { var s = this; s.playTone(660, 0.1, 'sine', 0.25); setTimeout(function () { s.playTone(880, 0.15, 'sine', 0.25); }, 80); },
        playStepWrong: function () { this.playTone(180, 0.25, 'sawtooth', 0.2); this.playTone(140, 0.3, 'square', 0.15); },
        playCountdown: function () { this.playTone(440, 0.1, 'sine', 0.15); },
        playVictory: function () { var s = this; [523, 659, 784, 1047, 784, 1047].forEach(function (f, i) { setTimeout(function () { s.playTone(f, 0.25, 'sine', 0.3); }, i * 150); }); },
        toggle: function () { this.enabled = !this.enabled; var s = App.Storage.getSettings(); s.soundEnabled = this.enabled; App.Storage.setSettings(s); }
    };

    // ===== 特效 =====
    App.FX = {
        bgParticles: [], confetti: [],
        init: function () { this.initBgCanvas(); this.initFxCanvas(); },
        initBgCanvas: function () {
            var canvas = document.getElementById('bg-canvas'); if (!canvas) return;
            var ctx = canvas.getContext('2d'), self = this;
            function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
            resize(); window.addEventListener('resize', resize);
            self.bgParticles = [];
            for (var i = 0; i < 40; i++) {
                self.bgParticles.push({
                    x: Math.random() * canvas.width, y: Math.random() * canvas.height,
                    r: Math.random() * 2 + 0.5, dx: (Math.random() - 0.5) * 0.4, dy: (Math.random() - 0.5) * 0.4,
                    alpha: Math.random() * 0.4 + 0.1,
                    color: ['108,92,231', '168,85,247', '6,182,212', '244,114,182'][Math.floor(Math.random() * 4)]
                });
            }
            function animate() {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                self.bgParticles.forEach(function (p) {
                    p.x += p.dx; p.y += p.dy;
                    if (p.x < 0) p.x = canvas.width; if (p.x > canvas.width) p.x = 0;
                    if (p.y < 0) p.y = canvas.height; if (p.y > canvas.height) p.y = 0;
                    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(' + p.color + ',' + p.alpha + ')'; ctx.fill();
                });
                requestAnimationFrame(animate);
            }
            animate();
        },
        initFxCanvas: function () {
            var canvas = document.getElementById('fx-canvas'); if (!canvas) return;
            var ctx = canvas.getContext('2d'), self = this;
            function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
            resize(); window.addEventListener('resize', resize);
            self.confetti = [];
            function animate() {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                self.confetti = self.confetti.filter(function (c) { return c.life > 0; });
                self.confetti.forEach(function (c) {
                    c.x += c.vx; c.y += c.vy; c.vy += 0.15; c.rotation += c.rotSpeed; c.life -= 1;
                    var alpha = Math.min(1, c.life / 30);
                    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.rotation * Math.PI / 180);
                    ctx.fillStyle = c.color.replace('1)', alpha + ')');
                    ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h); ctx.restore();
                });
                requestAnimationFrame(animate);
            }
            animate();
        },
        spawnConfetti: function (x, y, count) {
            count = count || 40;
            var colors = ['rgba(108,92,231,1)', 'rgba(168,85,247,1)', 'rgba(6,182,212,1)', 'rgba(244,114,182,1)', 'rgba(251,191,36,1)', 'rgba(34,197,94,1)'];
            for (var i = 0; i < count; i++) {
                this.confetti.push({
                    x: x || window.innerWidth / 2, y: y || window.innerHeight / 3,
                    vx: (Math.random() - 0.5) * 12, vy: -Math.random() * 10 - 3,
                    w: Math.random() * 8 + 4, h: Math.random() * 6 + 2,
                    rotation: Math.random() * 360, rotSpeed: (Math.random() - 0.5) * 10,
                    color: colors[Math.floor(Math.random() * colors.length)], life: Math.random() * 60 + 60
                });
            }
        },
        showScorePopup: function (pts, isCorrect) {
            var el = document.createElement('div');
            el.className = 'score-popup ' + (isCorrect ? 'positive' : 'negative');
            el.textContent = isCorrect ? '+' + pts : '\u2717';
            document.body.appendChild(el);
            setTimeout(function () { el.remove(); }, 1200);
        }
    };

    // ===== 升级考核恭喜页面 =====
    App.Celebration = {
        _confettiTimer: null,
        _fireworkTimer: null,
        show: function (opts) {
            // opts: { semesterName, difficulty, accuracy, score, maxStreak, unlocks: [{icon,label,name}] }
            var self = this;
            var overlay = document.getElementById('celebration-overlay');
            var subtitle = document.getElementById('celebration-subtitle');
            var unlocksDiv = document.getElementById('celebration-unlocks');
            var statsDiv = document.getElementById('celebration-stats');

            subtitle.textContent = (opts.semesterName || '') + ' · ' + (opts.difficulty || '') + '难度';

            // 解锁项
            unlocksDiv.innerHTML = '';
            (opts.unlocks || []).forEach(function (u) {
                var item = document.createElement('div');
                item.className = 'unlock-item';
                item.innerHTML = '<div class="unlock-icon">' + u.icon + '</div>' +
                    '<div class="unlock-text"><div class="unlock-label">' + u.label + '</div>' +
                    '<div class="unlock-name">' + u.name + '</div></div>';
                unlocksDiv.appendChild(item);
            });

            // 统计数据
            statsDiv.innerHTML = '';
            var stats = [
                { val: opts.accuracy + '%', label: '正确率' },
                { val: opts.score, label: '得分' },
                { val: opts.maxStreak, label: '最高连击' }
            ];
            stats.forEach(function (s) {
                var item = document.createElement('div');
                item.className = 'stat-item';
                item.innerHTML = '<div class="stat-val">' + s.val + '</div><div class="stat-label">' + s.label + '</div>';
                statsDiv.appendChild(item);
            });

            overlay.classList.remove('hidden');

            // 撒花 + 烟花持续效果
            App.FX.spawnConfetti(null, null, 60);
            var burst = 0;
            this._confettiTimer = setInterval(function () {
                App.FX.spawnConfetti(
                    Math.random() * window.innerWidth,
                    Math.random() * window.innerHeight * 0.5,
                    20
                );
                burst++;
                if (burst > 8) { clearInterval(self._confettiTimer); self._confettiTimer = null; }
            }, 400);

            // 烟花式爆发（从底部向上喷射）
            this._fireworkTimer = setTimeout(function () {
                var fwColors = ['rgba(251,191,36,1)', 'rgba(244,114,182,1)', 'rgba(6,182,212,1)', 'rgba(34,197,94,1)'];
                for (var i = 0; i < 40; i++) {
                    App.FX.confetti.push({
                        x: window.innerWidth / 2 + (Math.random() - 0.5) * 100,
                        y: window.innerHeight,
                        vx: (Math.random() - 0.5) * 14,
                        vy: -Math.random() * 16 - 10,
                        w: Math.random() * 6 + 3, h: Math.random() * 6 + 3,
                        rotation: Math.random() * 360, rotSpeed: (Math.random() - 0.5) * 12,
                        color: fwColors[Math.floor(Math.random() * fwColors.length)],
                        life: Math.random() * 50 + 80
                    });
                }
            }, 600);

            // 播放胜利音效
            App.Sound.playVictory();
        },
        hide: function () {
            var overlay = document.getElementById('celebration-overlay');
            overlay.classList.add('hidden');
            if (this._confettiTimer) { clearInterval(this._confettiTimer); this._confettiTimer = null; }
            if (this._fireworkTimer) { clearTimeout(this._fireworkTimer); this._fireworkTimer = null; }
        }
    };

    // ===== 悬浮解释提示系统 =====
    App.Tooltip = {
        _el: null,
        _currentTarget: null,
        _longPressTimer: null,
        _hideTimer: null,
        init: function () {
            var self = this;
            this._el = document.getElementById('setting-tip');
            if (!this._el) return;

            // PC 端：鼠标悬浮（事件委托，支持动态元素）
            document.addEventListener('mouseover', function (e) {
                var target = e.target.closest && e.target.closest('[data-tip]');
                if (target && target !== self._currentTarget) {
                    self._currentTarget = target;
                    self.show(target.getAttribute('data-tip'), e);
                } else if (target) {
                    self._move(e);
                }
            });
            document.addEventListener('mouseout', function (e) {
                var target = e.target.closest && e.target.closest('[data-tip]');
                if (!target) return;
                // 判断是否真正离开了当前 data-tip 元素
                var related = e.relatedTarget;
                if (!related || related.nodeType !== 1 || !target.contains(related)) {
                    self.hide();
                    self._currentTarget = null;
                }
            });

            // 移动端：长按显示
            document.addEventListener('touchstart', function (e) {
                var target = e.target.closest('[data-tip]');
                if (!target) return;
                var touch = e.touches[0];
                self._longPressTimer = setTimeout(function () {
                    self.show(target.getAttribute('data-tip'), { clientX: touch.clientX, clientY: touch.clientY });
                }, 500);
            }, { passive: true });
            document.addEventListener('touchmove', function () {
                if (self._longPressTimer) { clearTimeout(self._longPressTimer); self._longPressTimer = null; }
                self.hide();
            }, { passive: true });
            document.addEventListener('touchend', function () {
                if (self._longPressTimer) { clearTimeout(self._longPressTimer); self._longPressTimer = null; }
                // 延迟隐藏，方便用户阅读
                if (self._el.classList.contains('show')) {
                    self._hideTimer = setTimeout(function () { self.hide(); }, 2500);
                }
            });
        },
        show: function (text, e) {
            if (this._hideTimer) { clearTimeout(this._hideTimer); this._hideTimer = null; }
            this._el.textContent = text;
            this._el.classList.add('show');
            this._move(e);
        },
        _move: function (e) {
            var x = e.clientX, y = e.clientY;
            var tip = this._el;
            var tipRect = tip.getBoundingClientRect();
            // 默认显示在鼠标右下方
            var left = x + 14;
            var top = y + 18;
            // 右边界溢出 → 显示在左下方
            if (left + tipRect.width > window.innerWidth - 10) {
                left = x - tipRect.width - 14;
            }
            // 下边界溢出 → 显示在上方
            if (top + tipRect.height > window.innerHeight - 10) {
                top = y - tipRect.height - 14;
            }
            // 确保不超出左边
            if (left < 10) left = 10;
            if (top < 10) top = 10;
            tip.style.left = left + 'px';
            tip.style.top = top + 'px';
        },
        hide: function () {
            this._el.classList.remove('show');
            this._currentTarget = null;
        }
    };

    // ===== Toast =====
    App.Toast = {
        show: function (msg, type) {
            type = type || 'info';
            var container = document.getElementById('toast-container');
            var el = document.createElement('div');
            el.className = 'toast ' + type; el.textContent = msg;
            container.appendChild(el);
            setTimeout(function () { el.remove(); }, 3000);
        }
    };

    // ===== Modal =====
    App.Modal = {
        open: function (title, bodyHTML, footerHTML) {
            document.getElementById('modal-title').textContent = title;
            document.getElementById('modal-body').innerHTML = bodyHTML;
            document.getElementById('modal-footer').innerHTML = footerHTML || '';
            document.getElementById('modal-overlay').classList.add('active');
        },
        close: function () { document.getElementById('modal-overlay').classList.remove('active'); },
        closeOnOverlay: function (e) { if (e.target === document.getElementById('modal-overlay')) this.close(); }
    };

    // ===== 视图切换 =====
    App.switchView = function (viewId) {
        var views = document.querySelectorAll('.view');
        views.forEach(function (v) { v.classList.remove('active'); });
        var target = document.getElementById('view-' + viewId);
        if (target) target.classList.add('active');

        // 视图初始化
        if (viewId === 'home') App.Home.render();
        else if (viewId === 'profile') App.Profile.render();
        else if (viewId === 'semester') App.SemesterView.render();
        else if (viewId === 'badges') App.Badges.render();
        else if (viewId === 'settings') App.Settings.render();
        else if (viewId === 'exam-setup') App.ExamSetup.render();
    };

    // ===== 首页 =====
    App.Home = {
        render: function () {
            var student = App.Storage.getStudent();
            var lv = getLevel(student.totalPoints);
            // 显示登录用户名
            var authUser = App.Auth.getUsername();
            document.getElementById('home-student-name').textContent = authUser || student.name || '未设置';
            document.getElementById('home-student-level').textContent = 'Lv.' + lv.lv;
            document.getElementById('home-total-points').textContent = student.totalPoints;
            var acc = student.totalCount > 0 ? Math.round(student.totalCorrect / student.totalCount * 100) : 0;
            document.getElementById('home-accuracy').textContent = acc + '%';
            document.getElementById('home-sessions').textContent = student.sessions;

            // 测试模式标识
            var testBadge = document.getElementById('test-mode-badge');
            if (testBadge) testBadge.style.display = App.isTestMode() ? 'inline-block' : 'none';

            // 勋章总数
            var badgeCount = 0;
            var badges = student.badges || {};
            for (var k in badges) { badgeCount += badges[k] || 0; }
            document.getElementById('home-badges').textContent = badgeCount;

            // 当前学期（优先用户选择的）
            var curSem = App.Semester.getActiveSemester();
            // 难度优先使用用户在主页选中的，否则用当前应挑战的难度
            var curDiff = App.ExamSetup.selectedDifficulty || App.Semester.getCurrentDifficulty(curSem.id);
            // 校验选中难度是否已解锁，未解锁则回退到当前难度
            if (curDiff !== 'easy' && !App.Semester.isDifficultyUnlocked(curSem.id, curDiff)) {
                curDiff = App.Semester.getCurrentDifficulty(curSem.id);
                App.ExamSetup.selectedDifficulty = curDiff;
            }
            var progress = App.Semester.getProgress(curSem.id, curDiff);
            document.getElementById('home-semester-name').textContent = curSem.name;
            var diffName = { easy: '简单', medium: '中等', hard: '困难' }[curDiff];
            document.getElementById('home-semester-phase').textContent = App.Semester.getPhaseName(progress.phase) + ' · ' + diffName;

            // 渲染难度切换按钮
            this.renderDifficultyButtons(curSem.id, curDiff);

            // 渲染进度条和升级考核入口
            this.renderProgressBar(curSem.id, progress, curDiff);

            // 同步状态
            var syncEl = document.getElementById('home-sync-status');
            if (syncEl) {
                syncEl.textContent = App.FileSync._syncing ? '⏳' : '☁️';
                syncEl.className = 'sync-status' + (App.FileSync._syncing ? ' syncing' : '');
                syncEl.title = App.FileSync._syncing ? '正在同步...' : '点击查看同步';
                syncEl.onclick = function () { App.FileSync.openManager(); };
            }
        },

        // 渲染进度条和升级考核入口
        renderProgressBar: function (semesterId, progress, difficulty) {
            var fillEl = document.getElementById('home-progress-fill');
            var textEl = document.getElementById('home-progress-text');
            var btnEl = document.getElementById('btn-exam-entry');
            var hintEl = document.getElementById('exam-entry-hint');
            var sectionEl = document.getElementById('home-progress-section');
            if (!fillEl) return;

            var allChars = App.CharProb.getSemesterChars(semesterId, difficulty);
            var total = allChars.length;
            var tested = 0;
            var correct = 0;
            allChars.forEach(function (c) {
                if (c.tested) tested++;
                if (c.correctOnce) correct++;
            });

            var percent = 0;
            var currentCount = 0;
            var phaseLabel = '';

            if (progress.phase === 'assessment') {
                // 摸底阶段：已考字数/总字数
                currentCount = tested;
                percent = total > 0 ? Math.round(tested / total * 100) : 0;
                phaseLabel = '摸底';
            } else if (progress.phase === 'completion') {
                // 补全阶段：已答对字数/总字数
                currentCount = correct;
                percent = total > 0 ? Math.round(correct / total * 100) : 0;
                phaseLabel = '补全';
            } else if (progress.phase === 'exam') {
                // 考核阶段：100%
                percent = 100;
                currentCount = total;
                phaseLabel = '考核';
            } else if (progress.phase === 'completed') {
                percent = 100;
                currentCount = total;
                phaseLabel = '已完成';
            }

            fillEl.style.width = percent + '%';
            fillEl.classList.toggle('complete', percent >= 100);
            textEl.textContent = phaseLabel + ' ' + currentCount + '/' + total + ' (' + percent + '%)';

            // 升级考核入口：exam 阶段或已完成的难度都可点击
            // - exam 阶段：显示"升级考核"
            // - completed：显示"重新挑战"（允许二刷三刷）
            // - 其他：锁定
            var canChallenge = (progress.phase === 'exam' || progress.phase === 'completed');
            var btnTextEl = btnEl.querySelector('.exam-entry-text');
            if (canChallenge) {
                btnEl.classList.remove('locked');
                btnEl.classList.add('unlocked');
                if (progress.phase === 'completed') {
                    if (btnTextEl) btnTextEl.textContent = '重新挑战';
                    hintEl.textContent = '点击重考';
                } else {
                    if (btnTextEl) btnTextEl.textContent = '升级考核';
                    hintEl.textContent = '点击挑战';
                }
                hintEl.style.color = '';
            } else {
                btnEl.classList.remove('unlocked');
                btnEl.classList.add('locked');
                if (btnTextEl) btnTextEl.textContent = '升级考核';
                hintEl.textContent = '进度未满';
            }
        },

        // 渲染主页难度切换按钮：高亮选中难度，锁定未解锁难度
        renderDifficultyButtons: function (semesterId, currentDiff) {
            var btns = document.querySelectorAll('.home-difficulty .diff-btn');
            if (!btns || !btns.length) return;
            btns.forEach(function (btn) {
                var diff = btn.getAttribute('data-diff');
                var unlocked = App.Semester.isDifficultyUnlocked(semesterId, diff);
                btn.classList.toggle('active', diff === currentDiff);
                btn.classList.toggle('locked', !unlocked);
                btn.disabled = !unlocked;
            });
        },

        // 主页选择难度：保存选择并刷新主页显示
        selectDifficulty: function (diff) {
            var curSem = App.Semester.getActiveSemester();
            if (!App.Semester.isDifficultyUnlocked(curSem.id, diff)) {
                var hint = diff === 'medium' ? '需先通过本学期简单难度考核' : '需先通过本学期中等难度考核';
                App.Toast.show('该难度未解锁：' + hint, 'warn');
                return;
            }
            App.ExamSetup.selectedDifficulty = diff;
            App.Storage.set('selected_difficulty', diff);
            App.Sound.playClick();
            var diffName = { easy: '简单', medium: '中等', hard: '困难' }[diff];
            App.Toast.show('已选择 ' + diffName + ' 难度', 'success');
            this.render();
        }
    };

    // ===== 考试设置 =====
    App.ExamSetup = {
        selectedDifficulty: (function () {
            var saved = App.Storage ? App.Storage.get('selected_difficulty', null) : null;
            return saved || 'easy';
        })(),
        directStart: false, // true=选择难度后直接开始考试，false=返回主页

        render: function () {
            var curSem = App.Semester.getActiveSemester();
            var curDiff = App.Semester.getCurrentDifficulty(curSem.id);
            var progress = App.Semester.getProgress(curSem.id, curDiff);
            var diffName = { easy: '简单', medium: '中等', hard: '困难' }[curDiff];
            document.getElementById('setup-phase-name').textContent = App.Semester.getPhaseName(progress.phase) + ' · ' + diffName;
            document.getElementById('setup-semester-name').textContent = curSem.name;

            // 高亮选中的难度 + 锁定状态（按学期解锁）
            var cards = document.querySelectorAll('.diff-card');
            cards.forEach(function (c) {
                var diff = c.getAttribute('data-diff');
                var unlocked = App.Semester.isDifficultyUnlocked(curSem.id, diff);
                var diffProgress = App.Semester.getProgress(curSem.id, diff);
                c.classList.toggle('selected', diff === curDiff);
                c.classList.toggle('locked', !unlocked);
                c.classList.toggle('completed', diffProgress.completed);
            });
        },

        selectDifficulty: function (diff) {
            var curSem = App.Semester.getActiveSemester();
            // 检查难度是否已解锁（按学期）
            if (!App.Semester.isDifficultyUnlocked(curSem.id, diff)) {
                var hint = diff === 'medium' ? '需先通过本学期简单难度考核' : '需先通过本学期中等难度考核';
                App.Toast.show('该难度未解锁：' + hint, 'warn');
                return;
            }
            App.ExamSetup.selectedDifficulty = diff;
            App.Storage.set('selected_difficulty', diff);
            App.Sound.playClick();
            if (App.ExamSetup.directStart) {
                // 升级考核：选择难度后直接开始考试
                App.ExamSetup.directStart = false;
                App.Exam.start(diff);
            } else {
                // 普通选择：保存难度，返回主页
                App.Toast.show('已选择 ' + ({ easy: '简单', medium: '中等', hard: '困难' }[diff]) + ' 难度', 'success');
                App.switchView('home');
            }
        },

        // 升级考核入口（也用于重新挑战已完成的难度）
        enterExamChallenge: function () {
            var curSem = App.Semester.getActiveSemester();
            // 使用主页选中的难度，回退到当前应挑战的难度
            var curDiff = App.ExamSetup.selectedDifficulty || App.Semester.getCurrentDifficulty(curSem.id);
            // 校验难度已解锁
            if (!App.Semester.isDifficultyUnlocked(curSem.id, curDiff)) {
                App.Toast.show('该难度未解锁', 'warn');
                return;
            }
            var progress = App.Semester.getProgress(curSem.id, curDiff);

            // 已完成的难度：弹出重新挑战确认
            if (progress.completed) {
                var diffName = { easy: '简单', medium: '中等', hard: '困难' }[curDiff];
                App.Modal.open('重新挑战 ' + diffName + ' 难度',
                    '<div style="line-height:1.7">' +
                    '<p>当前难度已通过，重新挑战将：</p>' +
                    '<ul style="margin:8px 0;padding-left:20px;color:var(--text-secondary)">' +
                    '<li>清空本难度当前进度（重置摸底/补全/考核）</li>' +
                    '<li>从摸底阶段重新开始考核</li>' +
                    '<li>挑战完成后新成绩将<b style="color:var(--gold)">覆盖</b>旧成绩</li>' +
                    '<li style="color:var(--warning)">⚠️ 中途退出将不更新原数据</li>' +
                    '</ul>' +
                    '</div>',
                    '<button class="btn-modal-cancel" onclick="App.Modal.close()">取消</button>' +
                    '<button class="btn-modal-primary" onclick="App.ExamSetup._confirmRechallenge()">开始重新挑战</button>');
                return;
            }

            // exam 阶段：进入难度选择后直接开始考核
            if (progress.phase !== 'exam') {
                App.Toast.show('需完成摸底和补全阶段后才能参加升级考核', 'warn');
                return;
            }
            App.ExamSetup.directStart = true;
            App.switchView('exam-setup');
            App.Toast.show('请选择难度参加升级考核', 'info');
        },

        // 确认开始重新挑战
        _confirmRechallenge: function () {
            App.Modal.close();
            var curSem = App.Semester.getActiveSemester();
            var curDiff = App.ExamSetup.selectedDifficulty || App.Semester.getCurrentDifficulty(curSem.id);
            if (!App.Semester.startRechallenge(curSem.id, curDiff)) {
                App.Toast.show('无法启动重新挑战', 'error');
                return;
            }
            App.Toast.show('已开始重新挑战，请完成全部流程', 'info');
            // 直接开始考试（标记为重新挑战模式）
            App.Exam.start(curDiff, { isRechallenge: true });
        }
    };

    // ===== 考试核心 =====
    App.Exam = {
        questions: [],
        currentIndex: 0,
        difficulty: 'easy',
        score: 0,
        timer: null,
        timeLeft: 0,
        maxTime: 30,
        // 代理难度选择到ExamSetup
        selectDifficulty: function (diff) {
            App.ExamSetup.selectDifficulty(diff);
        },
        // 当前选择
        selectedInitial: '',
        selectedMedial: '',
        selectedFinal: '',
        selectedTone: -1, // -1表示未选择，0=轻声，1-4=声调
        // 推送步骤：initial → medial → final → tone
        currentStep: 'initial',
        _correctParsed: null, // 当前题的正确解析结果
        // 统计
        correctCount: 0,
        wrongCount: 0,
        maxStreak: 0,
        currentStreak: 0,
        totalTime: 0,
        // 详细统计
        toneCorrect: 0, toneTotal: 0,
        initialCorrect: 0, initialTotal: 0,
        medialCorrect: 0, medialTotal: 0,
        finalCorrect: 0, finalTotal: 0,
        earlyErrors: 0,
        // 错字记录
        wrongChars: [],
        // 字的答对/答错追踪（用于知错就改勋章）
        charResults: {},
        // 当前学期
        semesterId: '',
        // 阶段
        phase: 'assessment',
        // 是否已答题
        answered: false,
        // 是否为重新挑战模式（已完成的难度重新考核，中途退出恢复原数据）
        _isRechallenging: false,

        start: function (diff, options) {
            // 未指定难度时用当前选中的难度
            if (!diff) diff = App.ExamSetup.selectedDifficulty || 'easy';
            // 标记是否为重新挑战模式
            this._isRechallenging = !!(options && options.isRechallenge);
            // 检查是否有保存的进度可以恢复
            var saved = this.getSavedProgress();
            if (saved) {
                // 若恢复的进度属于当前活跃的重新挑战，则保持重新挑战标志
                var activeRc = App.Semester.getActiveRechallenge();
                if (activeRc && activeRc.semesterId === saved.semesterId && activeRc.difficulty === saved.difficulty) {
                    this._isRechallenging = true;
                }
                // 加载所需学期数据后恢复
                var self = this;
                var semestersToLoad = [saved.semesterId];
                var semIdx = -1;
                for (var i = 0; i < PinyinData.semesters.length; i++) {
                    if (PinyinData.semesters[i].id === saved.semesterId) { semIdx = i; break; }
                }
                if (semIdx > 0) {
                    for (var j = 0; j < semIdx; j++) {
                        semestersToLoad.push(PinyinData.semesters[j].id);
                    }
                }
                PinyinData.loadSemesters(semestersToLoad, function () {
                    self.resumeFromProgress(saved);
                });
                return;
            }

            this.difficulty = diff;
            this.score = 0;
            this.currentIndex = 0;
            this.correctCount = 0;
            this.wrongCount = 0;
            this.maxStreak = 0;
            this.currentStreak = 0;
            this.totalTime = 0;
            this.toneCorrect = 0; this.toneTotal = 0;
            this.initialCorrect = 0; this.initialTotal = 0;
            this.medialCorrect = 0; this.medialTotal = 0;
            this.finalCorrect = 0; this.finalTotal = 0;
            this.earlyErrors = 0;
            this.wrongChars = [];
            this.charResults = {};
            this.answered = false;

            var curSem = App.Semester.getActiveSemester();
            this.semesterId = curSem.id;
            var progress = App.Semester.getProgress(curSem.id, diff);
            this.phase = progress.phase;

            // 按需加载学期数据，加载完成后开始考试
            var self = this;
            var semIdx = -1;
            for (var i = 0; i < PinyinData.semesters.length; i++) {
                if (PinyinData.semesters[i].id === curSem.id) { semIdx = i; break; }
            }
            // 需要加载当前学期 + 之前学期（用于复习字）
            var semestersToLoad = [curSem.id];
            if (semIdx > 0) {
                for (var j = 0; j < semIdx; j++) {
                    semestersToLoad.push(PinyinData.semesters[j].id);
                }
            }

            PinyinData.loadSemesters(semestersToLoad, function () {
                console.log('[Exam] loadSemesters完成, chars[' + curSem.id + ']=' +
                    (PinyinData.chars[curSem.id] ? PinyinData.chars[curSem.id].length + '字' : '未加载'));
                self._startAfterLoad(curSem, progress, semIdx);
            });
        },

        _startAfterLoad: function (curSem, progress, semIdx) {
            // 根据阶段出题
            var questions;
            if (this.phase === 'assessment') {
                questions = App.QuestionPicker.pickAssessment(curSem.id, progress.lastWrongChars || [], this.difficulty);
            } else if (this.phase === 'completion') {
                questions = App.QuestionPicker.pickCompletion(curSem.id, this.difficulty);
            } else {
                questions = App.QuestionPicker.pickExam(curSem.id, this.difficulty);
            }

            // 非第一学期，混入30%复习字
            if (semIdx > 0) {
                questions = App.QuestionPicker.addReviewChars(questions, curSem.id);
            }

            if (questions.length === 0) {
                console.error('[Exam] 题库为空！semesterId=' + curSem.id +
                    ', charsLoaded=' + !!PinyinData.chars[curSem.id] +
                    ', charsCount=' + (PinyinData.chars[curSem.id] ? PinyinData.chars[curSem.id].length : 'N/A') +
                    ', phase=' + this.phase);
                App.Toast.show('该学期暂无字库（' + curSem.name + '），请检查字库文件', 'error');
                return;
            }

            this.questions = questions;
            App.switchView('exam');
            this.applyOptionFontSize();
            this.showQuestion();
        },

        // 选项字体大小控制
        _optionFontSize: 20,
        _optionFontSizeMin: 14,
        _optionFontSizeMax: 36,

        changeFontSize: function (delta) {
            this._optionFontSize = Math.max(this._optionFontSizeMin, Math.min(this._optionFontSizeMax, this._optionFontSize + delta * 2));
            this.applyOptionFontSize();
            // 保存到 localStorage
            App.Storage.setOptionFontSize(this._optionFontSize);
        },

        applyOptionFontSize: function () {
            var size = this._optionFontSize;
            document.documentElement.style.setProperty('--opt-font-size', size + 'px');
            var label = document.getElementById('font-size-label');
            if (label) label.textContent = size;
        },

        _loadOptionFontSize: function () {
            var saved = App.Storage.getOptionFontSize();
            if (saved) this._optionFontSize = Math.max(this._optionFontSizeMin, Math.min(this._optionFontSizeMax, saved));
        },

        // 步骤动画辅助
        _animStepBtn: function (btn, isCorrect) {
            if (!btn) return;
            var cls = isCorrect ? 'anim-step-correct' : 'anim-step-wrong';
            btn.classList.remove('anim-step-correct', 'anim-step-wrong');
            // 强制重绘以重新触发动画
            void btn.offsetWidth;
            btn.classList.add(cls);
            setTimeout(function () { btn.classList.remove(cls); }, isCorrect ? 400 : 500);
        },

        showQuestion: function () {
            if (this.currentIndex >= this.questions.length) {
                this.endSession();
                return;
            }

            var q = this.questions[this.currentIndex];
            var parsed = PinyinData.parsePinyin(q.pinyin);
            this._correctParsed = parsed;

            // 多音字支持：收集所有合法读音
            this._validParses = [parsed];
            if (q.altPinyin && q.altPinyin.length > 0) {
                for (var ai = 0; ai < q.altPinyin.length; ai++) {
                    var altParsed = PinyinData.parsePinyin(q.altPinyin[ai]);
                    this._validParses.push(altParsed);
                }
            }
            // 当前匹配的解析集合（每步选择后逐步缩小）
            this._matchingParses = this._validParses.slice();

            // 重置选择
            this.selectedInitial = '';
            this.selectedMedial = '';
            this.selectedFinal = '';
            this.selectedTone = -1;
            this.selectedTonePos = -1;
            this.answered = false;

            // 更新UI
            document.getElementById('target-char').textContent = q.char;
            document.getElementById('current-pinyin').innerHTML = '<span class="placeholder">_ _ _</span>';
            document.getElementById('exam-progress-text').textContent = (this.currentIndex + 1) + '/' + this.questions.length;
            document.getElementById('exam-score').textContent = this.score + '分';

            // 生成选项
            this.buildOptions(parsed);

            // 启动计时器
            var diffConfig = getDiffConfig(this.difficulty);
            this.maxTime = diffConfig.timer;
            this.timeLeft = this.maxTime;
            this.startTimer();

            // 推送第一步：声母
            this.currentStep = 'initial';
            this.showStep('initial');

            // 标记已测试（按当前难度）
            App.CharProb.markTested(q.semesterId || this.semesterId, q.char, this.difficulty);
        },

        buildOptions: function (correctParsed) {
            var diffConfig = getDiffConfig(this.difficulty);

            // 声母选项
            var initials = PinyinData.initials.slice();
            // 简单模式只取部分（保持字母序）
            if (diffConfig.initialCount < initials.length) {
                var correctInit = correctParsed.initial || '';
                var filtered = initials.filter(function (i) { return i !== correctInit; });
                // 取正确声母附近的声母，保持字母序
                var correctIdx = initials.indexOf(correctInit);
                var start = Math.max(0, correctIdx - Math.floor(diffConfig.initialCount / 2));
                var end = start + diffConfig.initialCount - 1;
                if (end >= filtered.length + 1) start = Math.max(0, filtered.length + 1 - diffConfig.initialCount);
                var selected = [];
                for (var si = 0; si < initials.length && selected.length < diffConfig.initialCount - 1; si++) {
                    if (initials[si] !== correctInit) selected.push(initials[si]);
                }
                selected = selected.slice(0, diffConfig.initialCount - 1);
                if (correctInit) selected.push(correctInit);
                // 保持字母序
                initials = selected.sort(function (a, b) {
                    return PinyinData.initials.indexOf(a) - PinyinData.initials.indexOf(b);
                });
            }

            // 固定在末尾添加"整体认读"和"不用声母"选项
            // 不加入声母网格，单独用2列网格排列

            var gridInit = document.getElementById('grid-initial');
            gridInit.innerHTML = '';
            // 移除之前创建的特殊网格
            var oldSpecial = document.getElementById('grid-initial-special');
            if (oldSpecial) oldSpecial.remove();
            initials.forEach(function (init) {
                var btn = document.createElement('button');
                btn.className = 'opt-btn';
                btn.textContent = init;
                btn.setAttribute('data-value', init);
                btn.onclick = function () { App.Exam.selectInitial(init, btn); };
                gridInit.appendChild(btn);
            });

            // 整体认读和不用声母单独2列排列
            var specialGrid = document.createElement('div');
            specialGrid.className = 'option-grid special-grid-2col';
            specialGrid.id = 'grid-initial-special';
            ['整体认读', '不用声母'].forEach(function (label) {
                var btn = document.createElement('button');
                btn.className = 'opt-btn special-opt';
                btn.textContent = label;
                btn.setAttribute('data-value', label);
                btn.onclick = function () { App.Exam.selectInitial(label, btn); };
                specialGrid.appendChild(btn);
            });
            gridInit.parentNode.insertBefore(specialGrid, gridInit.nextSibling);

            // 介母选项（i, u, ü + 无介母）
            var medials = ['i', 'u', 'ü'];
            // 按难度限制介母选项数量
            if (diffConfig.medialCount < medials.length + 1) {
                var correctMedial = correctParsed.medial || '';
                var selM = [];
                for (var mi = 0; mi < medials.length && selM.length < diffConfig.medialCount - 1; mi++) {
                    if (medials[mi] !== correctMedial) selM.push(medials[mi]);
                }
                selM = selM.slice(0, diffConfig.medialCount - 1);
                if (correctMedial) selM.push(correctMedial);
                medials = selM;
            }

            var gridMedial = document.getElementById('grid-medial');
            gridMedial.innerHTML = '';
            medials.forEach(function (m) {
                var btn = document.createElement('button');
                btn.className = 'opt-btn medial-btn';
                btn.textContent = m;
                btn.setAttribute('data-value', m);
                btn.onclick = function () { App.Exam.selectMedial(m, btn); };
                gridMedial.appendChild(btn);
            });
            // 无介母选项（多音字可能需要）
            var btnNoMedial = document.createElement('button');
            btnNoMedial.className = 'opt-btn medial-btn special-opt';
            btnNoMedial.textContent = '无介母';
            btnNoMedial.setAttribute('data-value', '');
            btnNoMedial.onclick = function () { App.Exam.selectMedial('', btnNoMedial); };
            gridMedial.appendChild(btnNoMedial);

            // 韵母选项（使用baseFinals，不含可分解的复合韵母）
            var finals;
            if (correctParsed.isWhole) {
                // 整体音节使用wholeSyllables
                finals = PinyinData.wholeSyllables.slice();
            } else {
                finals = PinyinData.baseFinals.slice();
            }
            if (diffConfig.finalCount < finals.length) {
                var correctFinal = correctParsed.final || '';
                var selectedF = [];
                for (var fi = 0; fi < finals.length && selectedF.length < diffConfig.finalCount - 1; fi++) {
                    if (finals[fi] !== correctFinal) selectedF.push(finals[fi]);
                }
                selectedF = selectedF.slice(0, diffConfig.finalCount - 1);
                if (correctFinal) selectedF.push(correctFinal);
                // 保持 aeiou 排序
                var finalOrder = correctParsed.isWhole ? PinyinData.wholeSyllables : PinyinData.baseFinals;
                finals = selectedF.sort(function (a, b) {
                    return finalOrder.indexOf(a) - finalOrder.indexOf(b);
                });
            }

            var gridFinal = document.getElementById('grid-final');
            gridFinal.innerHTML = '';
            finals.forEach(function (f) {
                var btn = document.createElement('button');
                btn.className = 'opt-btn';
                btn.textContent = f;
                btn.setAttribute('data-value', f);
                btn.onclick = function () { App.Exam.selectFinal(f, btn); };
                gridFinal.appendChild(btn);
            });

            // 声调选项
            var gridTone = document.getElementById('grid-tone');
            gridTone.innerHTML = '';
            PinyinData.tones.forEach(function (t) {
                var btn = document.createElement('button');
                btn.className = 'opt-btn tone-btn';
                btn.innerHTML = '<span class="tone-symbol">' + t.symbol + '</span><span class="tone-name">' + t.name + '</span>';
                btn.setAttribute('data-value', t.id);
                btn.onclick = function () { App.Exam.selectTone(t.id, btn); };
                gridTone.appendChild(btn);
            });
            // 轻声选项
            var btnLight = document.createElement('button');
            btnLight.className = 'opt-btn tone-btn';
            btnLight.innerHTML = '<span class="tone-symbol">·</span><span class="tone-name">轻声</span>';
            btnLight.setAttribute('data-value', '0');
            btnLight.onclick = function () { App.Exam.selectTone(0, btnLight); };
            gridTone.appendChild(btnLight);
        },

        selectInitial: function (val, btn) {
            if (this.currentStep !== 'initial' || this.answered) return;
            App.Sound.playClick();
            var btns = document.querySelectorAll('#grid-initial .opt-btn, #grid-initial-special .opt-btn');
            btns.forEach(function (b) { b.classList.remove('selected'); });
            btn.classList.add('selected');
            this.selectedInitial = val;

            var validParses = this._validParses;

            // 辅助：检查是否有任意合法解析匹配此声母类型
            function hasMatchingInit(v, parses) {
                return parses.some(function (p) {
                    if (v === '整体认读') return p.isWhole;
                    if (v === '不用声母') return !p.isWhole && !p.initial;
                    return !p.isWhole && p.initial && p.initial === v;
                });
            }

            // 选了"整体认读"或"不用声母"：判断是否有匹配的合法解析
            if (val === '整体认读') {
                var wholeParses = validParses.filter(function (p) { return p.isWhole; });
                if (wholeParses.length > 0) {
                    App.Sound.playStepCorrect();
                    this._animStepBtn(btn, true);
                    this.selectedInitial = '整体认读';
                    this._matchingParses = wholeParses;
                    // 构建整体认读音节选项
                    this._buildWholeOptions(wholeParses);
                    this.currentStep = 'whole';
                    this.updatePinyinDisplay();
                    this.showStep('whole');
                } else {
                    App.Sound.playStepWrong();
                    this._animStepBtn(btn, false);
                    this.updatePinyinDisplay();
                    this.confirmAnswer();
                }
                return;
            }
            if (val === '不用声母') {
                var noInitParses = validParses.filter(function (p) { return !p.isWhole && !p.initial; });
                if (noInitParses.length > 0) {
                    App.Sound.playStepCorrect();
                    this._animStepBtn(btn, true);
                    this.selectedInitial = '不用声母';
                    this._matchingParses = noInitParses;
                    this.updatePinyinDisplay();
                    // 判断匹配的解析中是否有介母
                    var hasMedial = noInitParses.some(function (p) { return !!p.medial; });
                    if (hasMedial) {
                        this.currentStep = 'medial';
                        this.showStep('medial');
                    } else {
                        this.selectedMedial = '';
                        this.currentStep = 'final';
                        this.showStep('final');
                    }
                } else {
                    App.Sound.playStepWrong();
                    this._animStepBtn(btn, false);
                    this.updatePinyinDisplay();
                    this.confirmAnswer();
                }
                return;
            }

            // 选了普通声母：检查是否有匹配的解析
            var initParses = validParses.filter(function (p) { return !p.isWhole && p.initial && p.initial === val; });
            if (initParses.length === 0) {
                // 没有任何合法解析匹配此声母，判错
                App.Sound.playStepWrong();
                this._animStepBtn(btn, false);
                this.updatePinyinDisplay();
                this.confirmAnswer();
                return;
            }

            App.Sound.playStepCorrect();
            this._animStepBtn(btn, true);
            this._matchingParses = initParses;
            this.updatePinyinDisplay();
            // 判断匹配的解析中是否有介母
            var hasMedial = initParses.some(function (p) { return !!p.medial; });
            var allNoMedial = initParses.every(function (p) { return !p.medial; });
            if (hasMedial && !allNoMedial) {
                // 部分有介母部分没有，显示介母步骤（含"无介母"选项）
                this.currentStep = 'medial';
                this.showStep('medial');
            } else if (hasMedial) {
                // 所有匹配解析都有介母
                this.currentStep = 'medial';
                this.showStep('medial');
            } else {
                // 所有匹配解析都无介母，跳过
                this.selectedMedial = '';
                this.currentStep = 'final';
                this.showStep('final');
            }
        },

        // 构建整体认读音节选项，优先选择相似的干扰项
        _buildWholeOptions: function (wholeParses) {
            var correctBases = wholeParses.map(function (p) { return p.base; });
            var diffConfig = getDiffConfig(this.difficulty);
            var optionCount = diffConfig.wholeCount || 5;
            // 确保不超过整体认读音节总数
            optionCount = Math.min(optionCount, PinyinData.wholeSyllables.length);
            console.log('[整体认读] 难度:', this.difficulty, '选项数:', optionCount, 'wholeCount配置:', diffConfig.wholeCount);

            // 找到正确答案所在的相似组
            var candidates = [];
            var correctBase = correctBases[0];

            // 优先从同一相似组中选干扰项
            PinyinData.wholeSyllableGroups.forEach(function (group) {
                if (group.indexOf(correctBase) >= 0) {
                    group.forEach(function (s) {
                        if (correctBases.indexOf(s) < 0 && candidates.indexOf(s) < 0) {
                            candidates.push(s);
                        }
                    });
                }
            });

            // 补充其他整体认读音节作为干扰
            PinyinData.wholeSyllables.forEach(function (s) {
                if (correctBases.indexOf(s) < 0 && candidates.indexOf(s) < 0) {
                    candidates.push(s);
                }
            });

            // 截取所需数量
            candidates = candidates.slice(0, optionCount - correctBases.length);

            // 合并正确答案和干扰项
            var options = correctBases.concat(candidates);
            // 打乱顺序
            for (var i = options.length - 1; i > 0; i--) {
                var j = Math.floor(Math.random() * (i + 1));
                var tmp = options[i]; options[i] = options[j]; options[j] = tmp;
            }

            var grid = document.getElementById('grid-whole');
            grid.innerHTML = '';
            var self = this;
            options.forEach(function (base) {
                var btn = document.createElement('button');
                btn.className = 'opt-btn whole-opt';
                btn.textContent = base;
                btn.setAttribute('data-value', base);
                btn.onclick = function () { self.selectWhole(base, btn); };
                grid.appendChild(btn);
            });
        },

        // 选择整体认读音节
        selectWhole: function (val, btn) {
            if (this.currentStep !== 'whole' || this.answered) return;
            App.Sound.playStepCorrect();
            if (btn) this._animStepBtn(btn, true);

            // 高亮选中按钮
            document.querySelectorAll('#grid-whole .opt-btn').forEach(function (b) {
                b.classList.remove('selected');
            });
            if (btn) btn.classList.add('selected');

            this.selectedMedial = '';
            this.selectedFinal = val;
            this.currentStep = 'tone';
            this.updatePinyinDisplay();
            this.showStep('tone');
        },

        selectMedial: function (val, btn) {
            if (this.currentStep !== 'medial' || this.answered) return;
            App.Sound.playClick();
            var btns = document.querySelectorAll('#grid-medial .opt-btn');
            btns.forEach(function (b) { b.classList.remove('selected'); });
            btn.classList.add('selected');
            this.selectedMedial = val;
            this.updatePinyinDisplay();

            // 多音字：检查是否有匹配的解析
            var medialParses = this._matchingParses.filter(function (p) {
                return (p.medial || '') === val;
            });
            if (medialParses.length === 0) {
                // 没有任何匹配解析，判错
                App.Sound.playStepWrong();
                this._animStepBtn(btn, false);
                this.confirmAnswer();
                return;
            }

            App.Sound.playStepCorrect();
            this._animStepBtn(btn, true);
            this._matchingParses = medialParses;
            // 自动推进到韵母
            this.currentStep = 'final';
            this.showStep('final');
        },

        selectFinal: function (val, btn) {
            if (this.currentStep !== 'final' || this.answered) return;
            App.Sound.playClick();
            var btns = document.querySelectorAll('#grid-final .opt-btn');
            btns.forEach(function (b) { b.classList.remove('selected'); });
            btn.classList.add('selected');
            this.selectedFinal = val;
            this.updatePinyinDisplay();

            // 多音字：检查是否有匹配的解析
            var finalParses = this._matchingParses.filter(function (p) {
                var correctFinal = p.isWhole ? p.base : p.final;
                return correctFinal === val;
            });
            if (finalParses.length === 0) {
                // 没有任何匹配解析，判错
                App.Sound.playStepWrong();
                this._animStepBtn(btn, false);
                this.confirmAnswer();
                return;
            }

            App.Sound.playStepCorrect();
            this._animStepBtn(btn, true);
            this._matchingParses = finalParses;
            // 选完韵母，直接进入声调选择
            this.currentStep = 'tone';
            this.showStep('tone');
        },

        // 获取当前韵母的完整字符串（介母+韵母，用于标调位置判断）
        _getFinalBaseStr: function () {
            var parsed = this._correctParsed;
            if (parsed.isWhole) {
                return parsed.base;
            }
            var med = this.selectedMedial || parsed.medial || '';
            var fin = this.selectedFinal || parsed.final || '';
            return med + fin;
        },

        selectTone: function (val, btn) {
            if (this.currentStep !== 'tone' || this.answered) return;
            App.Sound.playClick();
            var btns = document.querySelectorAll('#grid-tone .opt-btn');
            btns.forEach(function (b) { b.classList.remove('selected'); });
            btn.classList.add('selected');
            this.selectedTone = val;

            // 多音字：检查是否有匹配的解析
            var toneParses = this._matchingParses.filter(function (p) {
                return (p.tone || 0) === val;
            });
            if (toneParses.length === 0) {
                // 没有任何匹配解析，判错
                App.Sound.playStepWrong();
                this._animStepBtn(btn, false);
                this.updatePinyinDisplay();
                this.confirmAnswer();
                return;
            }

            App.Sound.playStepCorrect();
            this._animStepBtn(btn, true);
            this._matchingParses = toneParses;

            // 判断是否需要标调位置步骤：只有多个元音才需要
            var matchedParse = toneParses[0];
            var baseStr = this._getFinalBaseStrForParse(matchedParse);
            var init = (this.selectedInitial === '整体认读' || this.selectedInitial === '不用声母') ? '' : this.selectedInitial;
            if (init && 'jqxy'.indexOf(init) >= 0) {
                baseStr = baseStr.replace(/ü/g, 'u');
            }
            var vowels = PinyinData.getToneVowels(baseStr);
            if (vowels.length > 1) {
                // 多个元音，需要选标调位置
                this.currentStep = 'tonepos';
                this.updatePinyinDisplay();
                this.showStep('tonepos');
            } else {
                // 单个元音，自动确定标调位置，直接结算
                this.selectedTonePos = vowels.length === 1 ? PinyinData.getTonePosition(baseStr) : -1;
                this.updatePinyinDisplay();
                this.confirmAnswer();
            }
        },

        // 根据解析获取韵母完整字符串
        _getFinalBaseStrForParse: function (parsed) {
            if (parsed.isWhole) return parsed.base;
            return (parsed.medial || '') + parsed.final;
        },

        updatePinyinDisplay: function () {
            var init = (this.selectedInitial === '(无)' || this.selectedInitial === '整体认读' || this.selectedInitial === '不用声母') ? '' : this.selectedInitial;
            var med = this.selectedMedial || '';
            var final_ = this.selectedFinal;
            var tone = this.selectedTone >= 0 ? this.selectedTone : 0;

            var el = document.getElementById('current-pinyin');

            if (!final_ && !init && !med) {
                el.innerHTML = '<span class="placeholder">_ _ _</span>';
                return;
            }
            // 整体认读步骤中，还没选具体音节
            if (this.selectedInitial === '整体认读' && !final_) {
                el.innerHTML = '<span class="placeholder">整体认读 ?</span>';
                return;
            }

            // 构建不带声调的基础字符串
            var baseStr = '';
            if (final_) {
                baseStr = (med || '') + final_;
            } else if (med) {
                baseStr = med;
            }
            // j/q/x/y 后的 ü 写成 u
            if (init && 'jqxy'.indexOf(init) >= 0) {
                baseStr = baseStr.replace(/ü/g, 'u');
            }
            var fullBase = (init || '') + baseStr;

            if (!final_) {
                // 还没选韵母，简单显示
                el.textContent = fullBase || '_ _ _';
                return;
            }

            // 卡片化渲染：每个字母一个span，标调步骤时全部可交互
            var html = '';
            var initLen = init ? init.length : 0;
            for (var i = 0; i < fullBase.length; i++) {
                var ch = fullBase[i];
                var baseIdx = i - initLen; // 在baseStr中的索引
                var isVowel = 'aeiouü'.indexOf(ch) >= 0;
                var cls = 'pinyin-char';
                if (this.currentStep === 'tonepos') cls += ' pinyin-char-clickable';
                // 如果已选了标调位置
                if (this.selectedTonePos >= 0 && baseIdx === this.selectedTonePos && isVowel) {
                    // 在这个字母上标声调
                    var toned = PinyinData.addTone(ch, tone || 0);
                    html += '<span class="' + cls + ' pinyin-toned">' + toned + '</span>';
                } else {
                    html += '<span class="' + cls + '">' + ch + '</span>';
                }
            }
            el.innerHTML = html;

            // 绑定所有卡片点击事件
            if (this.currentStep === 'tonepos') {
                var self = this;
                // 先给每个字母添加data-base-idx
                el.querySelectorAll('.pinyin-char').forEach(function (span) {
                    var i2 = Array.from(span.parentNode.children).indexOf(span);
                    var bIdx = i2 - initLen;
                    span.setAttribute('data-base-idx', bIdx);
                });
                // 绑定可点击卡片的事件
                el.querySelectorAll('.pinyin-char-clickable').forEach(function (span) {
                    span.onclick = function () {
                        var idx = parseInt(this.getAttribute('data-base-idx'));
                        self.onPinyinCharClick(idx, this);
                    };
                });
            }
        },

        // 点击拼音卡片上的字母（标调位置）
        onPinyinCharClick: function (baseIdx, span) {
            if (this.answered) return;

            var baseStr = this._getFinalBaseStr();
            // j/q/x/y 后的 ü 写成 u
            var init = (this.selectedInitial === '整体认读' || this.selectedInitial === '不用声母') ? '' : this.selectedInitial;
            if (init && 'jqxy'.indexOf(init) >= 0) {
                baseStr = baseStr.replace(/ü/g, 'u');
            }
            var correctIdx = PinyinData.getTonePosition(baseStr);

            if (baseIdx !== correctIdx) {
                // 标调位置选错，立刻判错
                App.Sound.playStepWrong();
                this.selectedTonePos = baseIdx;
                this.confirmAnswer();
                return;
            }

            // 正确：标调位置选中
            App.Sound.playStepCorrect();
            this.selectedTonePos = baseIdx;
            // 高亮选中的字母
            var el = document.getElementById('current-pinyin');
            el.querySelectorAll('.pinyin-char-clickable').forEach(function (s) {
                s.classList.remove('pinyin-char-selected');
            });
            span.classList.add('pinyin-char-selected');
            // 移除可点击状态
            el.querySelectorAll('.pinyin-char-clickable').forEach(function (s) {
                s.classList.remove('pinyin-char-clickable');
                s.onclick = null;
            });

            this.updatePinyinDisplay();
            this.confirmAnswer();
        },

        // 推送式：只显示当前步骤的选择区
        showStep: function (step) {
            var sections = ['initial', 'whole', 'medial', 'final', 'tone'];
            var labels = { initial: '声母', whole: '整体认读音节', medial: '介母', final: '韵母', tonepos: '标调位置', tone: '声调' };
            sections.forEach(function (s) {
                var el = document.getElementById('section-' + s);
                if (s === step) {
                    el.style.display = '';
                    el.classList.add('active-step');
                } else {
                    el.style.display = 'none';
                    el.classList.remove('active-step');
                }
            });
            // tonepos步骤不显示选择区，在卡片上操作
            if (step === 'tonepos') {
                document.getElementById('section-tone').style.display = 'none';
            }
            // 更新步骤提示
            var hint = document.getElementById('step-hint');
            if (hint) hint.textContent = '请选择' + (labels[step] || '');
        },

        confirmAnswer: function () {
            if (this.answered) return;
            this.answered = true;
            this.stopTimer();

            var q = this.questions[this.currentIndex];
            var validParses = this._validParses;

            // 检查用户的完整答案是否匹配任意一个合法解析
            var matchedParse = null;
            for (var vi = 0; vi < validParses.length; vi++) {
                var parsed = validParses[vi];
                var correctInit;
                if (parsed.isWhole) { correctInit = '整体认读'; }
                else if (!parsed.initial) { correctInit = '不用声母'; }
                else { correctInit = parsed.initial; }
                var correctMedial = parsed.medial || '';
                var correctFinal = parsed.isWhole ? parsed.base : parsed.final;
                var correctTone = parsed.tone || 0;

                if (this.selectedInitial === correctInit &&
                    this.selectedMedial === correctMedial &&
                    this.selectedFinal === correctFinal &&
                    this.selectedTone === correctTone) {
                    matchedParse = parsed;
                    break;
                }
            }

            var isCorrect = !!matchedParse;
            // 用主解析做统计（如果匹配了替代解析，用匹配的解析）
            var statParsed = matchedParse || PinyinData.parsePinyin(q.pinyin);

            var correctInit;
            if (statParsed.isWhole) { correctInit = '整体认读'; }
            else if (!statParsed.initial) { correctInit = '不用声母'; }
            else { correctInit = statParsed.initial; }
            var correctMedial = statParsed.medial || '';
            var correctFinal = statParsed.isWhole ? statParsed.base : statParsed.final;
            var correctTone = statParsed.tone || 0;

            var initCorrect = this.selectedInitial === correctInit;
            var medialCorrect = this.selectedMedial === correctMedial;
            var finalCorrect = this.selectedFinal === correctFinal;
            var toneCorrect = this.selectedTone === correctTone;

            // 统计
            this.toneTotal++; if (toneCorrect) this.toneCorrect++;
            this.initialTotal++; if (initCorrect) this.initialCorrect++;
            this.medialTotal++; if (medialCorrect) this.medialCorrect++;
            this.finalTotal++; if (finalCorrect) this.finalCorrect++;

            if (isCorrect) {
                this.correctCount++;
                this.currentStreak++;
                if (this.currentStreak > this.maxStreak) this.maxStreak = this.currentStreak;

                // 计算分数
                var diffConfig = getDiffConfig(this.difficulty);
                var baseScore = diffConfig.baseScore;
                // 时间加成（按设置权重）：剩余时间比例 × 基础分
                var s = App.Storage.getSettings();
                var tw = (s.timeWeight || 50) / 100;
                var timeRatio = this.timeLeft / this.maxTime;
                var timeBonus = Math.round(baseScore * timeRatio * tw / (1 - tw));
                var totalPts = baseScore + timeBonus;
                this.score += totalPts;

                App.CharProb.onCorrect(q.semesterId || this.semesterId, q.char, this.difficulty);
                App.Sound.playCorrect();
                App.FX.showScorePopup(totalPts, true);
                App.FX.spawnConfetti(null, null, 25);

                this.charResults[q.char] = 'correct';
            } else {
                this.wrongCount++;
                this.currentStreak = 0;

                App.CharProb.onWrong(q.semesterId || this.semesterId, q.char);
                App.Sound.playWrong();
                App.FX.showScorePopup(0, false);

                if (this.charResults[q.char] !== 'correct') {
                    this.charResults[q.char] = 'wrong';
                }

                this.wrongChars.push(q.char);

                // 前5题错误计数
                if (this.currentIndex < 5) this.earlyErrors++;
            }

            // 显示反馈（传入匹配的解析或主解析）
            this.showFeedback(isCorrect, statParsed, isCorrect ? null : this._validParses);

            // 高亮正确/错误
            this.highlightAnswers(initCorrect, medialCorrect, finalCorrect, toneCorrect, correctInit, correctMedial, correctFinal, correctTone);
        },

        highlightAnswers: function (initCorrect, medialCorrect, finalCorrect, toneCorrect, correctInit, correctMedial, correctFinal, correctTone) {
            // 结算后显示所有步骤的按钮用于高亮
            var sections = ['initial', 'whole', 'medial', 'final', 'tonepos', 'tone'];
            sections.forEach(function (s) {
                var el = document.getElementById('section-' + s);
                if (el) {
                    el.style.display = '';
                    el.classList.remove('active-step');
                }
            });
            // 隐藏步骤提示
            var hint = document.getElementById('step-hint');
            if (hint) hint.textContent = '';

            // 禁用所有按钮
            document.querySelectorAll('.opt-btn').forEach(function (b) { b.classList.add('disabled'); });

            // 收集所有合法解析的正确值（用于高亮）
            var validInits = [], validMedials = [], validFinals = [], validTones = [];
            this._validParses.forEach(function (p) {
                var ci; if (p.isWhole) ci = '整体认读'; else if (!p.initial) ci = '不用声母'; else ci = p.initial;
                if (validInits.indexOf(ci) === -1) validInits.push(ci);
                var cm = p.medial || '';
                if (validMedials.indexOf(cm) === -1) validMedials.push(cm);
                var cf = p.isWhole ? p.base : p.final;
                if (validFinals.indexOf(cf) === -1) validFinals.push(cf);
                var ct = String(p.tone || 0);
                if (validTones.indexOf(ct) === -1) validTones.push(ct);
            });

            // 高亮声母
            document.querySelectorAll('#grid-initial .opt-btn, #grid-initial-special .opt-btn').forEach(function (b) {
                if (validInits.indexOf(b.getAttribute('data-value')) >= 0) b.classList.add('correct');
                else if (b.classList.contains('selected') && !initCorrect) b.classList.add('wrong');
            });
            // 高亮整体认读音节
            var isWholeSyllable = correctInit === '整体认读';
            document.querySelectorAll('#grid-whole .opt-btn').forEach(function (b) {
                if (validFinals.indexOf(b.getAttribute('data-value')) >= 0) b.classList.add('correct');
                else if (b.classList.contains('selected') && !finalCorrect) b.classList.add('wrong');
            });
            // 如果不是整体认读，隐藏整体认读选项区
            if (!isWholeSyllable) {
                var wholeSection = document.getElementById('section-whole');
                if (wholeSection) wholeSection.style.display = 'none';
            }
            // 高亮介母
            document.querySelectorAll('#grid-medial .opt-btn').forEach(function (b) {
                if (validMedials.indexOf(b.getAttribute('data-value')) >= 0) b.classList.add('correct');
                else if (b.classList.contains('selected') && !medialCorrect) b.classList.add('wrong');
            });
            // 高亮韵母
            document.querySelectorAll('#grid-final .opt-btn').forEach(function (b) {
                if (validFinals.indexOf(b.getAttribute('data-value')) >= 0) b.classList.add('correct');
                else if (b.classList.contains('selected') && !finalCorrect) b.classList.add('wrong');
            });
            // 高亮标调位置（在拼音卡片上）
            var baseStr = this._getFinalBaseStr();
            var correctTonePosIdx = PinyinData.getTonePosition(baseStr);
            // 重新渲染拼音卡片，标调位置高亮
            var pinyinEl = document.getElementById('current-pinyin');
            pinyinEl.querySelectorAll('.pinyin-char').forEach(function (span) {
                var bIdx = parseInt(span.getAttribute('data-base-idx'));
                if (!isNaN(bIdx)) {
                    if (bIdx === correctTonePosIdx) span.classList.add('pinyin-tone-correct');
                    else if (span.classList.contains('pinyin-vowel-selected') && bIdx !== correctTonePosIdx) span.classList.add('pinyin-tone-wrong');
                }
            });
            // 高亮声调
            document.querySelectorAll('#grid-tone .opt-btn').forEach(function (b) {
                if (validTones.indexOf(String(b.getAttribute('data-value'))) >= 0) b.classList.add('correct');
                else if (b.classList.contains('selected') && !toneCorrect) b.classList.add('wrong');
            });
        },

        showFeedback: function (isCorrect, correctParsed, validParses) {
            var overlay = document.getElementById('feedback-overlay');
            var icon = document.getElementById('feedback-icon');
            var text = document.getElementById('feedback-text');
            var pinyin = document.getElementById('feedback-pinyin');
            var confirmBtn = document.getElementById('feedback-confirm-btn');

            overlay.classList.remove('hidden');
            icon.textContent = isCorrect ? '✓' : '✗';
            text.textContent = isCorrect ? '正确!' : '答错了';
            text.className = 'feedback-text ' + (isCorrect ? 'correct' : 'wrong');

            // 显示完整拼音
            var fullPinyin = PinyinData.formatPinyin(correctParsed.initial, correctParsed.medial, correctParsed.final, correctParsed.tone);
            var allPinyinStr = fullPinyin;
            if (!isCorrect && validParses && validParses.length > 1) {
                allPinyinStr = validParses.map(function (p) {
                    return PinyinData.formatPinyin(p.initial, p.medial, p.final, p.tone);
                }).join(' / ');
            }

            // 构建分解信息（答对和答错都显示）
            var breakdownHTML = '';
            breakdownHTML = '<div class="feedback-breakdown">';
            // 完整拼音
            breakdownHTML += '<div class="feedback-full-pinyin">' + allPinyinStr + '</div>';

            if (correctParsed.isWhole) {
                // 整体认读音节
                breakdownHTML += '<div class="feedback-decomp"><span class="decomp-label">整体认读</span><span class="decomp-value">' + correctParsed.base + '</span></div>';
            } else {
                // 声母
                if (correctParsed.initial) {
                    breakdownHTML += '<div class="feedback-decomp"><span class="decomp-label">声母</span><span class="decomp-value">' + correctParsed.initial + '</span></div>';
                } else {
                    breakdownHTML += '<div class="feedback-decomp"><span class="decomp-label">不用声母</span><span class="decomp-value">-</span></div>';
                }
                // 介母
                if (correctParsed.medial) {
                    breakdownHTML += '<div class="feedback-decomp"><span class="decomp-label">介母</span><span class="decomp-value">' + correctParsed.medial + '</span></div>';
                }
                // 韵母
                breakdownHTML += '<div class="feedback-decomp"><span class="decomp-label">韵母</span><span class="decomp-value">' + correctParsed.final + '</span></div>';
            }

            // 声调
            var toneName = correctParsed.tone ? '第' + correctParsed.tone + '声' : '轻声';
            var toneSymbol = correctParsed.tone ? PinyinData.tones[correctParsed.tone - 1].symbol : '·';
            breakdownHTML += '<div class="feedback-decomp"><span class="decomp-label">声调</span><span class="decomp-value">' + toneSymbol + ' ' + toneName + '</span></div>';

            // 标调位置
            var baseStr = correctParsed.isWhole ? correctParsed.base : (correctParsed.medial || '') + correctParsed.final;
            var init = correctParsed.initial || '';
            if (init && 'jqxy'.indexOf(init) >= 0) {
                baseStr = baseStr.replace(/ü/g, 'u');
            }
            var tonePos = PinyinData.getTonePosition(baseStr);
            if (tonePos >= 0) {
                var tonedChar = baseStr[tonePos];
                var fullBase = (correctParsed.initial || '') + baseStr;
                breakdownHTML += '<div class="feedback-decomp"><span class="decomp-label">标调位置</span><span class="decomp-value">' + fullBase + ' 中的 <strong>' + tonedChar + '</strong></span></div>';
            }

            breakdownHTML += '</div>';

            pinyin.innerHTML = breakdownHTML;

            // 始终显示确定按钮
            confirmBtn.classList.remove('hidden');

            var self = this;
            if (this._feedbackTimer) { clearTimeout(this._feedbackTimer); this._feedbackTimer = null; }
            this._feedbackTimer = setTimeout(function () {
                self._dismissFeedback();
            }, isCorrect ? 800 : 15000);
        },

        // 点击确定按钮或超时后关闭反馈
        confirmFeedback: function () {
            if (this._feedbackTimer) { clearTimeout(this._feedbackTimer); this._feedbackTimer = null; }
            this._dismissFeedback();
        },

        _dismissFeedback: function () {
            var overlay = document.getElementById('feedback-overlay');
            var confirmBtn = document.getElementById('feedback-confirm-btn');
            overlay.classList.add('hidden');
            confirmBtn.classList.add('hidden');
            // 考核阶段：答错即终止（升级考核要求全对，错了已无升级可能）
            if (this.phase === 'exam' && this.wrongCount > 0) {
                App.Toast.show('考核阶段答错，本次考核失败', 'warn');
                this.endSession();
                return;
            }
            this.currentIndex++;
            this.totalTime += (this.maxTime - this.timeLeft);
            this.saveProgress();
            this.showQuestion();
        },

        startTimer: function () {
            this.stopTimer();
            var self = this;
            var fill = document.getElementById('exam-timer-fill');
            var text = document.getElementById('exam-timer-text');

            fill.style.width = '100%';
            fill.className = 'timer-fill';
            text.className = 'timer-text';
            text.textContent = this.timeLeft + 's';

            this.timer = setInterval(function () {
                self.timeLeft--;
                if (self.timeLeft < 0) self.timeLeft = 0;

                var pct = (self.timeLeft / self.maxTime) * 100;
                fill.style.width = pct + '%';
                text.textContent = self.timeLeft + 's';

                if (self.timeLeft <= 5) {
                    fill.className = 'timer-fill critical';
                    text.className = 'timer-text critical';
                    App.Sound.playCountdown();
                } else if (self.timeLeft <= self.maxTime * 0.3) {
                    fill.className = 'timer-fill warning';
                    text.className = 'timer-text warning';
                }

                if (self.timeLeft <= 0) {
                    self.stopTimer();
                    if (!self.answered) {
                        self.handleTimeout();
                    }
                }
            }, 1000);
        },

        stopTimer: function () {
            if (this.timer) { clearInterval(this.timer); this.timer = null; }
        },

        // 超时自动判错
        handleTimeout: function () {
            this.answered = true;
            this.wrongCount++;
            this.currentStreak = 0;
            this.toneTotal++; this.initialTotal++; this.medialTotal++; this.finalTotal++;

            var q = this.questions[this.currentIndex];
            App.CharProb.onWrong(q.semesterId || this.semesterId, q.char);
            this.wrongChars.push(q.char);
            if (this.currentIndex < 5) this.earlyErrors++;
            this.charResults[q.char] = 'wrong';

            var parsed = PinyinData.parsePinyin(q.pinyin);
            var correctInit;
            if (parsed.isWhole) { correctInit = '整体认读'; }
            else if (!parsed.initial) { correctInit = '不用声母'; }
            else { correctInit = parsed.initial; }
            var correctMedial = parsed.medial || '';
            var correctFinal = parsed.isWhole ? parsed.base : parsed.final;
            var correctTone = parsed.tone || 0;

            try {
                this.highlightAnswers(
                    this.selectedInitial === correctInit,
                    this.selectedMedial === correctMedial,
                    this.selectedFinal === correctFinal,
                    this.selectedTone === correctTone,
                    correctInit, correctMedial, correctFinal, correctTone
                );
            } catch (e) { /* 高亮失败不影响流程 */ }

            App.Sound.playWrong();
            // 超时后不进入正常反馈流程，而是弹出暂停对话框
            this.saveProgress();
            this.showPauseDialog();
        },

        // 超时暂停对话框（继续/退出 + 10秒倒计时自动保存退出）
        _pauseCountdownTimer: null,
        _pauseCountdownLeft: 10,
        showPauseDialog: function () {
            // 清理可能存在的旧倒计时
            if (this._pauseCountdownTimer) { clearInterval(this._pauseCountdownTimer); this._pauseCountdownTimer = null; }
            this._pauseCountdownLeft = 10;
            var self = this;

            var bodyHTML = '<p style="text-align:center;font-size:18px;margin-bottom:12px;">检测到超时，已自动暂停</p>' +
                '<p style="text-align:center;color:var(--warning);font-size:15px;margin-bottom:8px;">' +
                '当前题目已判错，进度已保存</p>' +
                '<p style="text-align:center;color:var(--danger);font-size:20px;font-weight:bold;" id="pause-countdown-text">' +
                '10秒内无操作将自动同步保存并退出</p>';

            var footerHTML = '<button class="btn-modal-cancel" onclick="App.Exam.continueAfterPause()">继续答题</button>' +
                '<button class="btn-danger-sm" onclick="App.Exam.exitAfterPause()">退出并保存</button>';

            App.Modal.open('已暂停', bodyHTML, footerHTML);

            // 10秒倒计时，到0自动执行同步保存退出
            this._pauseCountdownTimer = setInterval(function () {
                self._pauseCountdownLeft--;
                var el = document.getElementById('pause-countdown-text');
                if (el) el.textContent = self._pauseCountdownLeft + '秒内无操作将自动同步保存并退出';
                if (self._pauseCountdownLeft <= 0) {
                    self.exitAfterPause();
                }
            }, 1000);
        },

        // 暂停后继续答题
        continueAfterPause: function () {
            if (this._pauseCountdownTimer) { clearInterval(this._pauseCountdownTimer); this._pauseCountdownTimer = null; }
            App.Modal.close();
            // 考核阶段：暂停时当前题已超时判错，答错即终止
            if (this.phase === 'exam' && this.wrongCount > 0) {
                App.Toast.show('考核阶段答错，本次考核失败', 'warn');
                this.endSession();
                return;
            }
            // 进入下一题（与_dismissFeedback一致）
            this.currentIndex++;
            this.totalTime += (this.maxTime - this.timeLeft);
            this.saveProgress();
            this.showQuestion();
        },

        // 暂停后退出并同步保存
        exitAfterPause: function () {
            if (this._pauseCountdownTimer) { clearInterval(this._pauseCountdownTimer); this._pauseCountdownTimer = null; }
            App.Modal.close();
            // 重新挑战模式：暂停退出视为放弃，恢复原数据，不保存中途进度
            if (this._isRechallenging) {
                this.clearSavedProgress();
                App.Semester.cancelRechallenge();
                this._isRechallenging = false;
                App.Toast.show('重新挑战已取消，原数据已恢复', 'info');
                App.switchView('home');
                return;
            }
            // 当前题已判错，索引前进到下一题再保存，以便下次恢复从下一题开始
            this.currentIndex++;
            this.totalTime += (this.maxTime - this.timeLeft);
            this.saveProgress();
            // 触发一次同步上传到云端
            try { App.FileSync.syncAll(); } catch (e) { /* 同步失败不影响退出 */ }
            App.Toast.show('进度已保存，下次可继续', 'success');
            // 返回首页（不清除savedProgress，以便下次恢复）
            App.switchView('home');
        },

        // 提前结束考试
        endEarly: function () {
            if (this.answered) return; // 正在反馈中，不允许操作
            this.endSession(true);
        },

        // 保存当前考试进度（每题答完后调用）
        saveProgress: function () {
            var data = {
                semesterId: this.semesterId,
                phase: this.phase,
                difficulty: this.difficulty,
                questions: this.questions,
                currentIndex: this.currentIndex,
                score: this.score,
                correctCount: this.correctCount,
                wrongCount: this.wrongCount,
                maxStreak: this.maxStreak,
                currentStreak: this.currentStreak,
                totalTime: this.totalTime,
                toneCorrect: this.toneCorrect, toneTotal: this.toneTotal,
                initialCorrect: this.initialCorrect, initialTotal: this.initialTotal,
                medialCorrect: this.medialCorrect, medialTotal: this.medialTotal,
                finalCorrect: this.finalCorrect, finalTotal: this.finalTotal,
                earlyErrors: this.earlyErrors,
                wrongChars: this.wrongChars.slice(),
                charResults: JSON.parse(JSON.stringify(this.charResults))
            };
            App.Storage.setExamProgress(data);
        },

        // 清除已保存的考试进度
        clearSavedProgress: function () {
            App.Storage.setExamProgress(null);
        },

        // 获取已保存的考试进度
        getSavedProgress: function () {
            return App.Storage.getExamProgress();
        },

        // 从保存的进度恢复考试
        resumeFromProgress: function (saved) {
            this.semesterId = saved.semesterId;
            this.phase = saved.phase;
            this.difficulty = saved.difficulty;
            this.questions = saved.questions;
            this.currentIndex = saved.currentIndex;
            this.score = saved.score;
            this.correctCount = saved.correctCount;
            this.wrongCount = saved.wrongCount;
            this.maxStreak = saved.maxStreak;
            this.currentStreak = saved.currentStreak;
            this.totalTime = saved.totalTime;
            this.toneCorrect = saved.toneCorrect; this.toneTotal = saved.toneTotal;
            this.initialCorrect = saved.initialCorrect; this.initialTotal = saved.initialTotal;
            this.medialCorrect = saved.medialCorrect; this.medialTotal = saved.medialTotal;
            this.finalCorrect = saved.finalCorrect; this.finalTotal = saved.finalTotal;
            this.earlyErrors = saved.earlyErrors;
            this.wrongChars = saved.wrongChars || [];
            this.charResults = saved.charResults || {};
            this.answered = false;

            App.switchView('exam');
            this.showQuestion();
        },

        endSession: function (earlyEnd) {
            this.stopTimer();
            if (this._feedbackTimer) { clearTimeout(this._feedbackTimer); this._feedbackTimer = null; }
            this.clearSavedProgress();

            var totalQ = this.correctCount + this.wrongCount;
            var accuracy = totalQ > 0 ? Math.round(this.correctCount / totalQ * 100) : 0;
            var avgTime = totalQ > 0 ? Math.round(this.totalTime / totalQ * 10) / 10 : 0;

            // 评级（提前结束无评级加成）
            var gradeResult = earlyEnd ? { grade: '-', bonus: 0 } : calculateGrade(accuracy, this.maxStreak, avgTime);

            // 计算分数
            var diffConfig = getDiffConfig(this.difficulty);
            var baseScoreTotal = this.correctCount * diffConfig.baseScore;
            var timeBonusTotal = this.score - baseScoreTotal;
            var gradeBonus = earlyEnd ? 0 : Math.round(baseScoreTotal * gradeResult.bonus / 100);
            var totalScore = this.score + gradeBonus;

            // 半分检查
            var progress = App.Semester.getProgress(this.semesterId, this.difficulty);
            if (progress.halfScore) {
                totalScore = Math.round(totalScore / 2);
            }

            // 更新学生数据
            var student = App.Storage.getStudent();
            student.totalPoints += totalScore;
            student.totalCorrect += this.correctCount;
            student.totalCount += totalQ;
            student.sessions++;
            if (this.maxStreak > (student.maxStreak || 0)) student.maxStreak = this.maxStreak;

            // 检查勋章
            var phaseCompleted = '';
            if (this.phase === 'assessment') {
                var allChars = App.CharProb.getSemesterChars(this.semesterId, this.difficulty);
                var allTested = allChars.length > 0 && allChars.every(function (c) { return c.tested; });
                if (allTested) phaseCompleted = 'assessment';
            } else if (this.phase === 'exam' && accuracy === 100) {
                phaseCompleted = 'exam';
            }
            var sessionStats = {
                accuracy: accuracy, maxStreak: this.maxStreak, avgTime: avgTime,
                toneCorrect: this.toneCorrect, toneTotal: this.toneTotal,
                initialCorrect: this.initialCorrect, initialTotal: this.initialTotal,
                medialCorrect: this.medialCorrect, medialTotal: this.medialTotal,
                finalCorrect: this.finalCorrect, finalTotal: this.finalTotal,
                earlyErrors: this.earlyErrors,
                difficulty: this.difficulty,
                phaseCompleted: phaseCompleted
            };

            // 检查勋章（提前结束无勋章）
            var earnedBadges = [];
            if (!earlyEnd) {
                BADGE_DEFS.forEach(function (def) {
                    if (def.check(sessionStats)) {
                        if (Math.random() < def.prob) {
                            student.badges[def.id] = (student.badges[def.id] || 0) + 1;
                            earnedBadges.push(def);
                        }
                    }
                });

                // 积累型勋章：用当前难度通关学期时计数
                if (phaseCompleted === 'exam') {
                    var diffKey = this.difficulty + 'Completed';
                    student[diffKey] = (student[diffKey] || 0) + 1;
                }
                // 检查积累型勋章（必定获得，无概率）
                CUMULATIVE_BADGE_DEFS.forEach(function (def) {
                    if (!student.badges[def.id] && def.check(student)) {
                        student.badges[def.id] = 1;
                        earnedBadges.push(def);
                    }
                });
            }

            App.Storage.setStudent(student);

            // 更新学期进度
            this.updateSemesterProgress(accuracy);

            // 保存历史
            App.Storage.addHistory({
                semesterId: this.semesterId,
                phase: this.phase,
                difficulty: this.difficulty,
                score: totalScore,
                correctCount: this.correctCount,
                wrongCount: this.wrongCount,
                accuracy: accuracy,
                grade: gradeResult.grade,
                gradeBonus: gradeResult.bonus,
                badges: earnedBadges.map(function (b) { return b.id; }),
                earlyEnd: !!earlyEnd,
                time: new Date().toISOString()
            });

            // 显示结果
            this.showResult(totalScore, baseScoreTotal, timeBonusTotal, gradeBonus, gradeResult, accuracy, earnedBadges, earlyEnd);

            // 比赛结束后自动同步到云端
            App.FileSync.uploadData();

            // 重新挑战模式：根据是否完成 exam 决定保留新数据或恢复原数据
            if (this._isRechallenging) {
                var latestProgress = App.Semester.getProgress(this.semesterId, this.difficulty);
                if (latestProgress.completed) {
                    // 挑战完成（exam 100%通过），新数据生效
                    App.Semester.finishRechallenge();
                    this._isRechallenging = false;
                    App.Toast.show('重新挑战完成，新成绩已覆盖旧数据', 'success');
                } else if (earlyEnd || (this.phase === 'exam' && accuracy < 100)) {
                    // 提前结束 或 exam 失败：视为放弃，恢复原数据
                    App.Semester.cancelRechallenge();
                    this._isRechallenging = false;
                    App.Toast.show('重新挑战未完成，已恢复原数据', 'warn');
                }
                // 否则继续挑战（摸底/补全/考核阶段正常推进，不 finish 也不 cancel）
            }
        },

        updateSemesterProgress: function (accuracy) {
            var progress = App.Semester.getProgress(this.semesterId, this.difficulty);

            if (this.phase === 'assessment') {
                // 检查是否所有字都被测试过（按当前难度）
                var allChars = App.CharProb.getSemesterChars(this.semesterId, this.difficulty);
                // 防止空数组误判：数据未加载时不能判定为已完成
                var allTested = allChars.length > 0 && allChars.every(function (c) { return c.tested; });
                if (allTested) {
                    progress.assessmentDone = true;
                    progress.phase = 'completion';
                    progress.lastWrongChars = [];
                } else {
                    progress.lastWrongChars = this.wrongChars.slice();
                }
            } else if (this.phase === 'completion') {
                // 检查是否所有字都答对过一次（按当前难度）
                var allChars = App.CharProb.getSemesterChars(this.semesterId, this.difficulty);
                var allCorrect = allChars.length > 0 && allChars.every(function (c) { return c.correctOnce; });
                if (allCorrect) {
                    progress.completionDone = true;
                    progress.phase = 'exam';
                }
            } else if (this.phase === 'exam') {
                // 考核阶段：必须100%正确
                if (accuracy === 100) {
                    progress.examDone = true;
                    progress.completed = true;
                    progress.phase = 'completed';
                    // 收集解锁信息，稍后由恭喜页面统一展示
                    var unlocks = [];
                    // 解锁本学期下一难度
                    var diffName = { easy: '简单', medium: '中等', hard: '困难' }[this.difficulty];
                    if (this.difficulty === 'easy') {
                        unlocks.push({ icon: '⭐', label: '本学期解锁', name: '中等难度' });
                    } else if (this.difficulty === 'medium') {
                        unlocks.push({ icon: '⭐', label: '本学期解锁', name: '困难难度' });
                    }
                    // 解锁下一学期（上一学期任意难度完成即解锁）
                    var semIdx = -1;
                    for (var i = 0; i < PinyinData.semesters.length; i++) {
                        if (PinyinData.semesters[i].id === this.semesterId) { semIdx = i; break; }
                    }
                    if (semIdx >= 0 && semIdx < PinyinData.semesters.length - 1) {
                        unlocks.push({ icon: '🎓', label: '新学期解锁', name: PinyinData.semesters[semIdx + 1].name });
                    }
                    this._pendingCelebration = {
                        unlocks: unlocks,
                        diffName: diffName
                    };
                    // 考核通过后清除手动选择的学期，让 getCurrentSemester 自动前进到下一学期
                    App.selectedSemesterId = null;
                }
                // 考核失败，下次继续考核阶段
            }

            progress.sessions = (progress.sessions || 0) + 1;
            // 已完成学期再次挑战半分
            if (progress.completed) {
                progress.halfScore = true;
            }

            App.Semester.setProgress(this.semesterId, this.difficulty, progress);

            // 考核通过后强制验证解锁状态（防止数据未正确保存导致下一学期未解锁）
            if (this.phase === 'exam' && accuracy === 100) {
                var verifyProgress = App.Semester.getProgress(this.semesterId, this.difficulty);
                if (!verifyProgress.completed) {
                    // 数据未正确保存，强制重写
                    verifyProgress.completed = true;
                    verifyProgress.examDone = true;
                    verifyProgress.phase = 'completed';
                    App.Semester.setProgress(this.semesterId, this.difficulty, verifyProgress);
                    console.log('[考核] 检测到 completed 未保存，强制重写学期 ' + this.semesterId + ' 难度 ' + this.difficulty);
                }
            }
        },

        showResult: function (totalScore, baseScore, timeBonus, gradeBonus, gradeResult, accuracy, earnedBadges, earlyEnd) {
            App.switchView('result');

            document.getElementById('grade-letter').textContent = gradeResult.grade;
            document.getElementById('grade-bonus').textContent = gradeResult.bonus > 0 ? '+' + gradeResult.bonus + '%' : '-';
            document.getElementById('result-correct').textContent = this.correctCount + '/' + (this.correctCount + this.wrongCount);
            document.getElementById('result-accuracy').textContent = accuracy + '%';
            document.getElementById('result-base-score').textContent = baseScore;
            document.getElementById('result-time-bonus').textContent = timeBonus;
            document.getElementById('result-grade-bonus-val').textContent = gradeBonus;
            document.getElementById('result-total-score').textContent = totalScore;

            // 提前结束标记
            var resultGrade = document.getElementById('result-grade');
            if (earlyEnd) {
                resultGrade.classList.add('early-end');
            } else {
                resultGrade.classList.remove('early-end');
            }

            // 勋章
            var badgesDiv = document.getElementById('result-badges');
            badgesDiv.innerHTML = '';
            earnedBadges.forEach(function (b) {
                var item = document.createElement('div');
                item.className = 'badge-item';
                item.innerHTML = '<span class="badge-icon">' + b.icon + '</span><span class="badge-name">' + b.name + '</span>';
                badgesDiv.appendChild(item);
            });

            // 阶段信息
            var phaseInfo = document.getElementById('result-phase-info');
            var progress = App.Semester.getProgress(this.semesterId, this.difficulty);
            if (progress.completed) {
                var semName = '';
                for (var i = 0; i < PinyinData.semesters.length; i++) {
                    if (PinyinData.semesters[i].id === this.semesterId) { semName = PinyinData.semesters[i].name; break; }
                }
                phaseInfo.textContent = '恭喜通过 ' + semName + ' 考核！';
                phaseInfo.style.color = 'var(--gold)';
                // 触发炫酷恭喜页面（含解锁信息）
                if (this._pendingCelebration) {
                    var celebData = this._pendingCelebration;
                    this._pendingCelebration = null;
                    // 延迟显示，让结果页面先渲染
                    var self = this;
                    setTimeout(function () {
                        App.Celebration.show({
                            semesterName: semName,
                            difficulty: celebData.diffName,
                            accuracy: accuracy,
                            score: totalScore,
                            maxStreak: self.maxStreak,
                            unlocks: celebData.unlocks
                        });
                    }, 800);
                } else {
                    // 再次挑战通关（无新解锁），简单撒花
                    App.Sound.playVictory();
                    App.FX.spawnConfetti();
                }
            } else {
                phaseInfo.textContent = '当前阶段：' + App.Semester.getPhaseName(progress.phase) + ' | 继续加油！';
                phaseInfo.style.color = '';
            }
        }
    };

    // ===== 个人信息 =====
    App.Profile = {
        render: function () {
            var student = App.Storage.getStudent();
            var lv = getLevel(student.totalPoints);
            var nextLv = getNextLevel(student.totalPoints);

            document.getElementById('profile-name-input').value = student.name || '';
            document.getElementById('profile-level').textContent = 'Lv.' + lv.lv + ' ' + lv.name;
            document.getElementById('profile-points').textContent = student.totalPoints + ' 积分';

            var acc = student.totalCount > 0 ? Math.round(student.totalCorrect / student.totalCount * 100) : 0;
            document.getElementById('pstat-total').textContent = student.totalCount;
            document.getElementById('pstat-correct').textContent = student.totalCorrect;
            document.getElementById('pstat-accuracy').textContent = acc + '%';
            document.getElementById('pstat-streak').textContent = student.maxStreak || 0;

            // 等级进度条
            document.getElementById('level-current-name').textContent = 'Lv.' + lv.lv + ' ' + lv.name;
            if (nextLv) {
                document.getElementById('level-next-name').textContent = 'Lv.' + nextLv.lv + ' ' + nextLv.name;
                var progress = (student.totalPoints - lv.minPts) / (nextLv.minPts - lv.minPts) * 100;
                document.getElementById('level-bar-fill').style.width = Math.min(100, progress) + '%';
                document.getElementById('level-current-pts').textContent = student.totalPoints;
                document.getElementById('level-next-pts').textContent = nextLv.minPts;
            } else {
                document.getElementById('level-next-name').textContent = 'MAX';
                document.getElementById('level-bar-fill').style.width = '100%';
                document.getElementById('level-current-pts').textContent = student.totalPoints;
                document.getElementById('level-next-pts').textContent = '∞';
            }
        },

        saveName: function () {
            var name = document.getElementById('profile-name-input').value.trim();
            if (!name) { App.Toast.show('请输入姓名', 'warning'); return; }
            var student = App.Storage.getStudent();
            student.name = name;
            App.Storage.setStudent(student);
            App.Sound.playCorrect();
            App.Toast.show('姓名已保存', 'success');
        }
    };

    // ===== 学期选择 =====
    App.SemesterView = {
        render: function () {
            var list = document.getElementById('semester-list');
            list.innerHTML = '';
            var curSem = App.Semester.getCurrentSemester();

            PinyinData.semesters.forEach(function (sem) {
                var unlocked = App.Semester.isUnlocked(sem.id);
                var curDiff = App.Semester.getCurrentDifficulty(sem.id);
                var progress = App.Semester.getProgress(sem.id, curDiff);
                var isCurrent = sem.id === curSem.id;

                var card = document.createElement('div');
                card.className = 'semester-card' + (isCurrent ? ' current' : '') + (!unlocked ? ' locked' : '');

                var icon = progress.completed ? '✅' : (isCurrent ? '📖' : (!unlocked ? '🔒' : '📘'));
                var status = progress.completed ? '已完成' : (isCurrent ? App.Semester.getPhaseName(progress.phase) : (!unlocked ? '未解锁' : '可挑战'));
                var phaseTag = isCurrent && !progress.completed ? '<span class="sem-phase-tag">' + App.Semester.getPhaseName(progress.phase) + '</span>' : '';
                var charCount = PinyinData.getSemesterCharCount(sem.id);

                card.innerHTML = '<span class="sem-icon">' + icon + '</span>' +
                    '<div class="sem-info"><div class="sem-name">' + sem.name + '</div>' +
                    '<div class="sem-status">' + status + (charCount > 0 ? ' · ' + charCount + '字' : '') + '</div></div>' +
                    phaseTag;

                if (unlocked) {
                    card.onclick = function () {
                        // 已解锁的学期都可点击进入
                        App.selectedSemesterId = sem.id;
                        if (progress.completed) {
                            App.Toast.show('再次挑战该学期将分数减半', 'info');
                        }
                        // 进入难度选择，选择后返回主页
                        App.ExamSetup.directStart = false;
                        App.switchView('exam-setup');
                    };
                }

                list.appendChild(card);
            });

            // 按需加载当前学期的数据（用于显示字数）
            PinyinData.loadSemester(curSem.id, function () {
                // 重新渲染当前学期卡片以显示字数
                var cards = list.querySelectorAll('.semester-card.current .sem-status');
                if (cards.length > 0) {
                    var count = PinyinData.getSemesterCharCount(curSem.id);
                    var curDiff = App.Semester.getCurrentDifficulty(curSem.id);
                    var progress = App.Semester.getProgress(curSem.id, curDiff);
                    cards[0].textContent = App.Semester.getPhaseName(progress.phase) + (count > 0 ? ' · ' + count + '字' : '');
                }
            });
        }
    };

    // ===== 勋章 =====
    App.Badges = {
        // 当前激活的标签：badges 或 scores
        currentTab: 'badges',
        render: function () {
            var student = App.Storage.getStudent();
            var badges = student.badges || {};
            var grid = document.getElementById('badges-grid');
            grid.innerHTML = '';

            // 单场勋章
            BADGE_DEFS.forEach(function (def) {
                var count = badges[def.id] || 0;
                var card = document.createElement('div');
                card.className = 'badge-card' + (count > 0 ? ' earned' : '');
                card.innerHTML = '<div class="badge-icon-lg">' + def.icon + '</div>' +
                    '<div class="badge-title">' + def.name + '</div>' +
                    (count > 0 ? '<div class="badge-count">x' + count + '</div>' : '') +
                    '<div class="badge-desc">' + def.desc + '</div>';
                grid.appendChild(card);
            });

            // 积累型勋章
            CUMULATIVE_BADGE_DEFS.forEach(function (def) {
                var count = badges[def.id] || 0;
                var card = document.createElement('div');
                card.className = 'badge-card' + (count > 0 ? ' earned' : '');
                card.innerHTML = '<div class="badge-icon-lg">' + def.icon + '</div>' +
                    '<div class="badge-title">' + def.name + '</div>' +
                    (count > 0 ? '<div class="badge-count">x' + count + '</div>' : '') +
                    '<div class="badge-desc">' + def.desc + '</div>';
                grid.appendChild(card);
            });

            // 恢复上次的标签状态
            this.switchTab(this.currentTab);
        },

        // 切换荣誉/成绩标签
        switchTab: function (tab) {
            this.currentTab = tab;
            var badgesGrid = document.getElementById('badges-grid');
            var scoresTable = document.getElementById('scores-table');
            var tabBtns = document.querySelectorAll('#badges-tab-bar .tab-btn');
            tabBtns.forEach(function (btn, idx) {
                var isActive = (tab === 'badges' && idx === 0) || (tab === 'scores' && idx === 1);
                btn.classList.toggle('active', isActive);
            });
            if (badgesGrid) badgesGrid.style.display = tab === 'badges' ? 'grid' : 'none';
            if (scoresTable) scoresTable.style.display = tab === 'scores' ? 'block' : 'none';
            if (tab === 'scores') this.renderScores();
        },

        // 渲染成绩表格：每学期每难度的状态/正确率/场次
        renderScores: function () {
            var table = document.getElementById('scores-table');
            if (!table) return;
            var semesters = PinyinData.semesters;
            var diffs = ['easy', 'medium', 'hard'];
            var diffNames = { easy: '简单', medium: '中等', hard: '困难' };
            var html = '<div class="score-row header">' +
                '<div class="score-cell">学期</div>' +
                '<div class="score-cell">难度</div>' +
                '<div class="score-cell">状态</div>' +
                '<div class="score-cell">正确率</div>' +
                '<div class="score-cell">场次</div>' +
                '</div>';
            var self = this;
            semesters.forEach(function (sem) {
                diffs.forEach(function (diff) {
                    var progress = App.Semester.getProgress(sem.id, diff);
                    // 统计该难度下已测试/已答对字数
                    var stats = self.getDiffStats(sem.id, diff);
                    var accuracy = stats.tested > 0 ? Math.round(stats.correct / stats.tested * 100) : 0;
                    var status, statusClass;
                    if (progress.completed) {
                        status = '已完成';
                        statusClass = 'done';
                    } else if (App.Semester.isDifficultyUnlocked(sem.id, diff)) {
                        status = App.Semester.getPhaseName(progress.phase);
                        statusClass = 'progress';
                    } else {
                        status = '未解锁';
                        statusClass = 'locked';
                    }
                    html += '<div class="score-row">' +
                        '<div class="score-cell">' + sem.name + '</div>' +
                        '<div class="score-cell"><span class="score-diff ' + diff + '">' + diffNames[diff] + '</span></div>' +
                        '<div class="score-cell"><span class="score-status ' + statusClass + '">' + status + '</span></div>' +
                        '<div class="score-cell">' + accuracy + '%</div>' +
                        '<div class="score-cell">' + (progress.sessions || 0) + '</div>' +
                        '</div>';
                });
            });
            table.innerHTML = html;
        },

        // 获取某学期某难度的字数统计（已测试/已答对）
        getDiffStats: function (semesterId, difficulty) {
            var allChars = App.CharProb.getSemesterChars(semesterId, difficulty);
            var tested = 0, correct = 0;
            allChars.forEach(function (c) {
                if (c.tested) tested++;
                if (c.correctOnce) correct++;
            });
            return { tested: tested, correct: correct, total: allChars.length };
        }
    };

    // ===== 测试模式 =====
    // 进入测试模式：备份所有数据 → 清空 → 设标志 → 刷新
    // 退出测试模式：清空 → 恢复备份 → 清标志 → 刷新
    App.TestMode = {
        enter: function () {
            App.Modal.open('进入测试模式',
                '<div style="line-height:1.7">' +
                '<p>测试模式用于快速验证升级流程：</p>' +
                '<ul style="margin:8px 0;padding-left:20px;color:var(--text-secondary)">' +
                '<li>每学期仅 ' + TEST_CONFIG.charsPerSemester + ' 个字</li>' +
                '<li>每场考 ' + TEST_CONFIG.charsPerSession + ' 个字（2场即可通关）</li>' +
                '<li>测试进度独立保存，不影响正常数据</li>' +
                '<li>退出后自动恢复正常数据</li>' +
                '</ul>' +
                '<p style="color:var(--gold)">将刷新页面进入测试模式。</p>' +
                '</div>',
                '<button class="btn-modal-cancel" onclick="App.Modal.close()">取消</button>' +
                '<button class="btn-modal-primary" onclick="App.TestMode._doEnter()">进入测试模式</button>');
        },
        _doEnter: function () {
            // 认证相关 key 不备份不清空，保持登录状态
            var authKeys = [
                STORAGE_PREFIX + 'auth_user',
                STORAGE_PREFIX + 'auth_pass',
                STORAGE_PREFIX + 'auth_logged_in'
            ];
            // 1. 备份所有 PINYINLIANXI_ 开头的 key（排除测试模式标志、备份本身、认证 key）
            var keysToBackup = [];
            for (var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i);
                if (key.indexOf(STORAGE_PREFIX) === 0 &&
                    key !== TEST_MODE_KEY &&
                    key.indexOf(TEST_BACKUP_PREFIX) !== 0 &&
                    authKeys.indexOf(key) === -1) {
                    keysToBackup.push(key);
                }
            }
            keysToBackup.forEach(function (key) {
                localStorage.setItem(TEST_BACKUP_PREFIX + key, localStorage.getItem(key));
                localStorage.removeItem(key);
            });
            // 2. 设测试模式标志
            localStorage.setItem(TEST_MODE_KEY, '1');
            // 3. 刷新页面
            window.location.reload();
        },
        exit: function () {
            App.Modal.open('退出测试模式',
                '<p style="text-align:center">将退出测试模式，恢复正常数据。测试期间的进度将被清除。</p>',
                '<button class="btn-modal-cancel" onclick="App.Modal.close()">取消</button>' +
                '<button class="btn-modal-primary" onclick="App.TestMode._doExit()">退出测试模式</button>');
        },
        _doExit: function () {
            // 1. 清空当前所有 PINYINLIANXI_ 数据（测试模式产生的）
            var keysToRemove = [];
            for (var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i);
                if (key.indexOf(STORAGE_PREFIX) === 0 &&
                    key !== TEST_MODE_KEY &&
                    key.indexOf(TEST_BACKUP_PREFIX) !== 0) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(function (key) { localStorage.removeItem(key); });
            // 2. 恢复备份
            var backupKeys = [];
            for (var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i);
                if (key.indexOf(TEST_BACKUP_PREFIX) === 0) {
                    backupKeys.push(key);
                }
            }
            backupKeys.forEach(function (bk) {
                var originalKey = bk.substring(TEST_BACKUP_PREFIX.length);
                localStorage.setItem(originalKey, localStorage.getItem(bk));
                localStorage.removeItem(bk);
            });
            // 3. 清测试模式标志
            localStorage.removeItem(TEST_MODE_KEY);
            // 4. 刷新页面
            window.location.reload();
        }
    };

    // ===== 设置 =====
    App.Settings = {
        render: function () {
            var s = App.Storage.getSettings();
            // 游戏参数
            document.getElementById('setting-penalty-rate').value = s.penaltyRate || 100;
            document.getElementById('setting-penalty-val').textContent = (s.penaltyRate || 100) + '%';
            document.getElementById('setting-chars-per-session').value = s.charsPerSession || 30;
            document.getElementById('setting-chars-val').textContent = s.charsPerSession || 30;
            document.getElementById('setting-review-ratio').value = s.reviewRatio || 30;
            document.getElementById('setting-review-val').textContent = (s.reviewRatio || 30) + '%';
            // 难度参数
            document.getElementById('setting-easy-timer').value = s.easyTimer || 30;
            document.getElementById('setting-easy-timer-val').textContent = (s.easyTimer || 30) + 's';
            document.getElementById('setting-medium-timer').value = s.mediumTimer || 20;
            document.getElementById('setting-medium-timer-val').textContent = (s.mediumTimer || 20) + 's';
            document.getElementById('setting-hard-timer').value = s.hardTimer || 12;
            document.getElementById('setting-hard-timer-val').textContent = (s.hardTimer || 12) + 's';
            document.getElementById('setting-easy-score').value = s.easyScore || 10;
            document.getElementById('setting-easy-score-val').textContent = s.easyScore || 10;
            document.getElementById('setting-medium-score').value = s.mediumScore || 15;
            document.getElementById('setting-medium-score-val').textContent = s.mediumScore || 15;
            document.getElementById('setting-hard-score').value = s.hardScore || 20;
            document.getElementById('setting-hard-score-val').textContent = s.hardScore || 20;
            document.getElementById('setting-time-weight').value = s.timeWeight || 50;
            document.getElementById('setting-time-weight-val').textContent = (s.timeWeight || 50) + '%';
            // 评级参数
            document.getElementById('setting-sss-acc').value = s.sssAcc || 97;
            document.getElementById('setting-sss-acc-val').textContent = (s.sssAcc || 97) + '%';
            document.getElementById('setting-sss-streak').value = s.sssStreak || 15;
            document.getElementById('setting-sss-streak-val').textContent = s.sssStreak || 15;
            document.getElementById('setting-max-bonus').value = s.maxBonus || 40;
            document.getElementById('setting-max-bonus-val').textContent = (s.maxBonus || 40) + '%';
            // 系统设置
            document.getElementById('setting-sound').checked = s.soundEnabled !== false;
            document.getElementById('setting-auto-save').value = s.autoSaveInterval || 1;
            document.getElementById('setting-auto-save-val').textContent = s.autoSaveInterval || 1;
            document.getElementById('setting-feedback-font-size').value = s.feedbackFontSize || 28;
            document.getElementById('setting-feedback-font-size-val').textContent = (s.feedbackFontSize || 28) + 'px';
            document.getElementById('setting-pinyin-display-size').value = s.pinyinDisplaySize || 56;
            document.getElementById('setting-pinyin-display-size-val').textContent = (s.pinyinDisplaySize || 56) + 'px';

            // 事件绑定
            var self = this;
            // 游戏参数
            document.getElementById('setting-penalty-rate').oninput = function () {
                document.getElementById('setting-penalty-val').textContent = this.value + '%';
                var s = App.Storage.getSettings(); s.penaltyRate = parseInt(this.value); App.Storage.setSettings(s);
            };
            document.getElementById('setting-chars-per-session').oninput = function () {
                document.getElementById('setting-chars-val').textContent = this.value;
                var s = App.Storage.getSettings(); s.charsPerSession = parseInt(this.value); App.Storage.setSettings(s);
            };
            document.getElementById('setting-review-ratio').oninput = function () {
                document.getElementById('setting-review-val').textContent = this.value + '%';
                var s = App.Storage.getSettings(); s.reviewRatio = parseInt(this.value); App.Storage.setSettings(s);
            };
            // 难度参数
            document.getElementById('setting-easy-timer').oninput = function () {
                document.getElementById('setting-easy-timer-val').textContent = this.value + 's';
                var s = App.Storage.getSettings(); s.easyTimer = parseInt(this.value); App.Storage.setSettings(s);
            };
            document.getElementById('setting-medium-timer').oninput = function () {
                document.getElementById('setting-medium-timer-val').textContent = this.value + 's';
                var s = App.Storage.getSettings(); s.mediumTimer = parseInt(this.value); App.Storage.setSettings(s);
            };
            document.getElementById('setting-hard-timer').oninput = function () {
                document.getElementById('setting-hard-timer-val').textContent = this.value + 's';
                var s = App.Storage.getSettings(); s.hardTimer = parseInt(this.value); App.Storage.setSettings(s);
            };
            document.getElementById('setting-easy-score').oninput = function () {
                document.getElementById('setting-easy-score-val').textContent = this.value;
                var s = App.Storage.getSettings(); s.easyScore = parseInt(this.value); App.Storage.setSettings(s);
            };
            document.getElementById('setting-medium-score').oninput = function () {
                document.getElementById('setting-medium-score-val').textContent = this.value;
                var s = App.Storage.getSettings(); s.mediumScore = parseInt(this.value); App.Storage.setSettings(s);
            };
            document.getElementById('setting-hard-score').oninput = function () {
                document.getElementById('setting-hard-score-val').textContent = this.value;
                var s = App.Storage.getSettings(); s.hardScore = parseInt(this.value); App.Storage.setSettings(s);
            };
            document.getElementById('setting-time-weight').oninput = function () {
                document.getElementById('setting-time-weight-val').textContent = this.value + '%';
                var s = App.Storage.getSettings(); s.timeWeight = parseInt(this.value); App.Storage.setSettings(s);
            };
            // 评级参数
            document.getElementById('setting-sss-acc').oninput = function () {
                document.getElementById('setting-sss-acc-val').textContent = this.value + '%';
                var s = App.Storage.getSettings(); s.sssAcc = parseInt(this.value); App.Storage.setSettings(s);
            };
            document.getElementById('setting-sss-streak').oninput = function () {
                document.getElementById('setting-sss-streak-val').textContent = this.value;
                var s = App.Storage.getSettings(); s.sssStreak = parseInt(this.value); App.Storage.setSettings(s);
            };
            document.getElementById('setting-max-bonus').oninput = function () {
                document.getElementById('setting-max-bonus-val').textContent = this.value + '%';
                var s = App.Storage.getSettings(); s.maxBonus = parseInt(this.value); App.Storage.setSettings(s);
            };
            // 系统设置
            document.getElementById('setting-sound').onchange = function () {
                var s = App.Storage.getSettings(); s.soundEnabled = this.checked; App.Storage.setSettings(s); App.Sound.enabled = this.checked;
            };
            document.getElementById('setting-auto-save').oninput = function () {
                document.getElementById('setting-auto-save-val').textContent = this.value;
                var s = App.Storage.getSettings(); s.autoSaveInterval = parseInt(this.value); App.Storage.setSettings(s);
                App.FileSync.startAutoSave(); // 重新启动以应用新间隔
            };
            document.getElementById('setting-feedback-font-size').oninput = function () {
                document.getElementById('setting-feedback-font-size-val').textContent = this.value + 'px';
                var s = App.Storage.getSettings(); s.feedbackFontSize = parseInt(this.value); App.Storage.setSettings(s);
                document.documentElement.style.setProperty('--feedback-answer-size', this.value + 'px');
            };
            document.getElementById('setting-pinyin-display-size').oninput = function () {
                document.getElementById('setting-pinyin-display-size-val').textContent = this.value + 'px';
                var s = App.Storage.getSettings(); s.pinyinDisplaySize = parseInt(this.value); App.Storage.setSettings(s);
                document.documentElement.style.setProperty('--pinyin-display-size', this.value + 'px');
            };

            // 测试模式按钮状态
            var testBtn = document.getElementById('setting-test-mode-btn');
            if (testBtn) {
                if (App.isTestMode()) {
                    testBtn.textContent = '退出测试';
                    testBtn.style.background = 'rgba(251,191,36,0.2)';
                    testBtn.style.color = 'var(--gold)';
                    testBtn.onclick = function () { App.TestMode.exit(); };
                } else {
                    testBtn.textContent = '进入测试';
                    testBtn.style.background = '';
                    testBtn.style.color = '';
                    testBtn.onclick = function () { App.TestMode.enter(); };
                }
            }
        },

        // 难度参数解锁状态
        _lockedUnlocked: false,

        toggleLocked: function () {
            var group = document.getElementById('setting-locked-group');
            var icon = document.getElementById('setting-lock-icon');
            if (this._lockedUnlocked) {
                // 已解锁，收起并锁定
                group.style.display = 'none';
                icon.textContent = '🔒';
                this._lockedUnlocked = false;
                return;
            }
            // 需要密码解锁
            App.Modal.open('输入密码', '<p style="text-align:center;color:var(--warning)">游戏参数影响考试公平性，需输入密码才能修改</p>' +
                '<div style="text-align:center;margin-top:10px"><input type="password" id="setting-lock-pwd" placeholder="请输入密码" style="padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px;width:180px;text-align:center"></div>',
                '<button class="btn-modal-cancel" onclick="App.Modal.close()">取消</button>' +
                '<button class="btn-modal-primary" onclick="App.Settings._doUnlock()">确认</button>');
        },

        _doUnlock: function () {
            var pwd = document.getElementById('setting-lock-pwd');
            if (pwd && pwd.value === '666666') {
                this._lockedUnlocked = true;
                document.getElementById('setting-locked-group').style.display = '';
                document.getElementById('setting-lock-icon').textContent = '🔓';
                App.Modal.close();
            } else {
                App.Toast.show('密码错误', 'error');
            }
        },

        resetData: function () {
            App.Modal.open('确认重置', '<p style="text-align:center;color:var(--danger)">将清除云端和本地的所有数据，此操作不可撤销！</p>',
                '<button class="btn-modal-cancel" onclick="App.Modal.close()">取消</button>' +
                '<button class="btn-modal-primary" onclick="App.Settings.doReset()">确认重置</button>');
        },

        doReset: function () {
            var self = this;
            // 1. 先停止一切自动同步
            App.FileSync.stopAutoSave();

            // 2. 通知文件管理器删除云端数据（6.0：逐个文件删除云端行）
            App.Toast.show('正在清理云端数据，请稍候...', 'info');
            App.Modal.close();

            // 注册一次性消息监听，等云端删完再清本地
            var handlerKey = '_resetWaiting';
            App.FileSync[handlerKey] = true;

            // 逐个发送云端删除指令（6.0 无批量删除）
            var idx = [];
            try { idx = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'file_index') || '[]'); } catch (e) { idx = []; }
            var sentCount = 0;
            for (var ri2 = 0; ri2 < idx.length; ri2++) {
                var fid = idx[ri2] && idx[ri2].id;
                if (fid && !idx[ri2].isNewFile) {
                    App.FileSync.postMsg({ type: 'fileDeleted_local', fileId: fid });
                    sentCount++;
                }
            }

            // 设置超时兜底：5秒后清本地（云端删除在后台继续）
            var fallbackTimer = setTimeout(function () {
                if (App.FileSync[handlerKey]) {
                    App.FileSync[handlerKey] = false;
                    self._doLocalReset();
                }
            }, 5000);

            // 保存timer以便收到回复时清除
            App.FileSync._resetFallbackTimer = fallbackTimer;

            // 无云端文件 → 直接清本地
            if (sentCount === 0) {
                clearTimeout(fallbackTimer);
                App.FileSync._resetFallbackTimer = null;
                App.FileSync[handlerKey] = false;
                self._doLocalReset();
            }
        },

        _doLocalReset: function () {
            // 清除所有PINYINLIANXI_前缀的数据
            var keysToRemove = [];
            for (var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i);
                if (key && key.indexOf(STORAGE_PREFIX) === 0) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(function (k) { localStorage.removeItem(k); });
            // 重置加载状态，以便重新加载学期数据
            PinyinData._loaded = {};
            PinyinData.chars = {};
            App.Toast.show('数据已重置（云端+本地）', 'success');
            App.Home.render();
        }
    };

    // ===== 认证模块 =====
    App.Auth = {
        STORAGE_KEY_USER: STORAGE_PREFIX + 'auth_user',
        STORAGE_KEY_PASS: STORAGE_PREFIX + 'auth_pass',
        STORAGE_KEY_LOGGED_IN: STORAGE_PREFIX + 'auth_logged_in',

        // 获取当前登录用户名
        getUsername: function () {
            return localStorage.getItem(this.STORAGE_KEY_USER) || '';
        },

        // 获取当前登录密码
        getPassword: function () {
            return localStorage.getItem(this.STORAGE_KEY_PASS) || '';
        },

        // 是否已登录
        isLoggedIn: function () {
            var flag = localStorage.getItem(this.STORAGE_KEY_LOGGED_IN);
            // 明确退出过（flag='false'），不再自动登录
            if (flag === 'false') return false;
            // 从未设置过登录标记，但有本地数据，视为已登录（老用户兼容）
            if (flag === null) {
                var hasLocalData = localStorage.getItem(FILE_INDEX_KEY) !== null ||
                    localStorage.getItem(STORAGE_PREFIX + 'student') !== null;
                if (hasLocalData) {
                    localStorage.setItem(this.STORAGE_KEY_LOGGED_IN, 'true');
                    return true;
                }
                return false;
            }
            return flag === 'true';
        },

        // 登录成功后调用
        onLoginSuccess: function (username, password) {
            localStorage.setItem(this.STORAGE_KEY_USER, username);
            localStorage.setItem(this.STORAGE_KEY_PASS, password);
            localStorage.setItem(this.STORAGE_KEY_LOGGED_IN, 'true');
            // 隐藏登录弹窗
            App.Auth.hideLogin();
            // 初始化主应用并切换到首页
            App._initMainApp();
            // 传递认证信息到文件管理器
            App.Auth.syncAuthToFileManager();
            // 登录后检查云端并同步数据
            setTimeout(function () {
                App.FileSync.checkCloudAndInit();
            }, 1500);
            App.Toast.show('欢迎，' + username, 'success');
        },

        // 退出登录
        logout: function () {
            App.Modal.open('确认退出', '<p style="text-align:center;color:var(--warning)">退出后需要重新登录才能使用应用</p>',
                '<button class="btn-modal-cancel" onclick="App.Modal.close()">取消</button>' +
                '<button class="btn-modal-primary" onclick="App.Auth.doLogout()">确认退出</button>');
        },

        doLogout: function () {
            // 清空所有 PINYINLIANXI_ 开头的本地缓存（保留 device_id）
            var keysToRemove = [];
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && k.indexOf('PINYINLIANXI_') === 0 && k !== 'PINYINLIANXI_device_id') {
                    keysToRemove.push(k);
                }
            }
            for (var ri = 0; ri < keysToRemove.length; ri++) {
                localStorage.removeItem(keysToRemove[ri]);
            }
            // 重置初始化标记
            App._mainAppInitialized = false;
            // 通知文件管理器登出
            App.FileSync.postMsg({ type: 'logout' });
            // 停止自动同步
            App.FileSync.stopAutoSave();
            App.Modal.close();
            App.Auth.showLogin();
            App.Toast.show('已退出登录，本地缓存已清空', 'info');
        },

        // 打开账号管理（弹出登录弹窗，切换到修改密码标签）
        showAccountManager: function () {
            if (this.shouldUseStandaloneLogin()) {
                window.location.href = 'denglu.html?standalone=1&tab=changepwd';
                return;
            }
            var frame = document.getElementById('loginFrame');
            if (frame) {
                frame.src = 'denglu.html?tab=changepwd';
            }
            App.Auth.showLogin();
        },

        // 将认证信息同步到文件管理器（后台+弹窗两个iframe）
        syncAuthToFileManager: function () {
            var username = this.getUsername();
            var password = this.getPassword();
            if (!username) return;
            var frames = [document.getElementById('fileManagerBg'), document.getElementById('fileManagerFrame')];
            for (var i = 0; i < frames.length; i++) {
                var frame = frames[i];
                if (frame && frame.contentWindow) {
                    try {
                        frame.contentWindow.postMessage({
                            target: 'fileManager',
                            type: 'authChanged',
                            username: username,
                            password: password
                        }, '*');
                    } catch (e) { }
                }
            }
        },

        // 检测Android版本，返回版本号或-1（非Android/无法确定）
        getAndroidVersion: function () {
            var ua = navigator.userAgent;
            var match = ua.match(/Android\s+(\d+)/);
            if (match && match[1]) {
                return parseInt(match[1], 10);
            }
            return -1; // 非Android或无法确定
        },

        // 判断是否应使用独立登录页（非iframe弹窗）
        // 安卓低于14 → 跳转独立登录页；电脑/非安卓 → iframe弹窗；无法确定 → 跳转独立登录页
        shouldUseStandaloneLogin: function () {
            var ver = this.getAndroidVersion();
            if (ver === -1) {
                // 非Android设备：电脑端走iframe弹窗
                if (!/Android/i.test(navigator.userAgent)) {
                    return false; // 电脑端，允许iframe弹窗
                }
                // UA含Android但无法解析版本号，视为低版本
                return true;
            }
            // 低于安卓14，跳转独立登录页
            return ver < 14;
        },

        // 检查登录状态，未登录则显示登录弹窗
        checkAuth: function () {
            if (!this.isLoggedIn()) {
                App.Auth.showLogin();
                return false;
            }
            return true;
        },

        // 显示登录弹窗（低版本安卓或无法确定设备时直接跳转独立登录页）
        showLogin: function () {
            if (this.shouldUseStandaloneLogin()) {
                window.location.href = 'denglu.html?standalone=1';
                return;
            }
            var overlay = document.getElementById('loginOverlay');
            if (overlay) overlay.classList.add('active');
            // 延迟加载iframe：确保容器已可见后再加载，修复老WebView输入框不渲染问题
            var frame = document.getElementById('loginFrame');
            if (frame && (frame.src === 'about:blank' || frame.src === '' || !frame.src)) {
                frame.src = 'denglu.html';
            }
        },

        // 隐藏登录弹窗
        hideLogin: function () {
            var overlay = document.getElementById('loginOverlay');
            if (overlay) overlay.classList.remove('active');
            // 恢复iframe为默认登录页
            var frame = document.getElementById('loginFrame');
            if (frame && frame.src.indexOf('tab=changepwd') > -1) {
                frame.src = 'denglu.html';
            }
        }
    };

    // ===== 云同步（多文件协议版） =====
    App.FileSync = {
        CLOUD_TABLE: '拼音练习',
        KEY_PREFIX: 'PINYINLIANXI',

        _frame: null,
        _frameReady: false,
        _syncing: false,
        _autoSaveTimer: null,

        // 获取当前编辑文件名（当前学期文件）
        getCurrentEditFileName: function () {
            var curSem = App.Semester.getCurrentSemester();
            return curSem ? getSemesterFileName(curSem.id) : '';
        },

        // 获取当前活动iframe引用（弹窗打开时用弹窗，否则用后台）
        _isManagerOpen: false,
        getFrame: function () {
            if (this._isManagerOpen) {
                var modalFrame = document.getElementById('fileManagerFrame');
                if (modalFrame) return modalFrame;
            }
            return document.getElementById('fileManagerBg') || document.getElementById('fileManagerFrame');
        },

        // 向文件管理器发消息
        postMsg: function (msg) {
            var frame = this.getFrame();
            if (!frame || !frame.contentWindow) return;
            msg.target = 'fileManager';
            try { frame.contentWindow.postMessage(msg, '*'); } catch (e) { }
        },

        // 推送某文件内容到管理器（未就绪时先排队）
        _pendingPush: [],
        _pushContent: function (name, content) {
            if (!name || content === undefined || content === null) return;
            if (!this._frameReady) { this._pendingPush.push({ name: name, content: content }); return; }
            this.postMsg({ type: 'contentChanged', name: name, content: content });
        },
        _flushPending: function () {
            if (!this._pendingPush || !this._pendingPush.length) return;
            var q = this._pendingPush; this._pendingPush = [];
            for (var i = 0; i < q.length; i++) this.postMsg({ type: 'contentChanged', name: q[i].name, content: q[i].content });
        },
        // 推送本地所有非空文件内容
        pushAllLocalFiles: function () {
            var idx = getFileIndex();
            for (var i = 0; i < idx.length; i++) {
                var entry = idx[i];
                if (!entry.name || !entry.id) continue;
                var content = readFileData(entry.id);
                if (content) this._pushContent(entry.name, content);
            }
        },

        // 初始化文件管理器（后台iframe常驻 + 弹窗iframe按需）
        initFrame: function () {
            var self = this;
            var bg = document.getElementById('fileManagerBg');
            var modalFrame = document.getElementById('fileManagerFrame');

            var onReady = function () {
                self._frameReady = true;
                // 发送初始化配置
                self.postMsg({
                    type: 'initConfig',
                    appPrefix: self.KEY_PREFIX,
                    config: {
                        appPrefix: self.KEY_PREFIX,
                        sheetName: self.CLOUD_TABLE,
                        enabled: true,
                        autoSyncScope: 'all',
                        mirrorPrefix: '★'
                    }
                });
                // 通知管理器宿主已就绪，启动自动同步
                self.postMsg({ type: 'mainReady' });
                // 传递认证信息到文件管理器
                App.Auth.syncAuthToFileManager();
                // 补发排队中的内容
                self._flushPending();
            };

            if (bg) {
                bg.addEventListener('load', onReady);
                bg.src = '文件管理.HTML';
            }
            if (modalFrame) {
                modalFrame.addEventListener('load', function () {
                    App.Auth.syncAuthToFileManager();
                });
            }
        },

        // 打开文件管理器弹窗
        openManager: function () {
            var self = this;
            var modal = document.getElementById('file-modal');
            if (!modal) return;
            modal.classList.add('active');
            this._isManagerOpen = true;

            // 延迟加载iframe：确保容器已可见后再加载，修复老WebView输入框不渲染问题
            var frame = document.getElementById('fileManagerFrame');
            if (frame && (frame.src === 'about:blank' || frame.src === '' || !frame.src)) {
                frame.addEventListener('load', function once() {
                    frame.removeEventListener('load', once);
                    self._notifyManagerOpen();
                });
                frame.src = '文件管理.HTML';
            }
            this._notifyManagerOpen();
        },

        // 通知管理器当前编辑的文件
        _notifyManagerOpen: function () {
            var curFileName = this.getCurrentEditFileName();
            var curContent = '';
            var curEntry = findIndexByName(curFileName);
            if (curEntry) {
                curContent = readFileData(curEntry.id) || '';
            }
            this.postMsg({
                type: 'open',
                currentFileName: curFileName,
                currentContent: curContent
            });
        },

        // 关闭文件管理器弹窗
        closeManager: function () {
            this._isManagerOpen = false;
            var modal = document.getElementById('file-modal');
            if (modal) modal.classList.remove('active');
        },

        // 通知文件管理器当前编辑文件内容已变更
        notifyContentChanged: function () {
            var curFileName = this.getCurrentEditFileName();
            var curEntry = findIndexByName(curFileName);
            if (curEntry) {
                var content = readFileData(curEntry.id) || '';
                this.postMsg({
                    type: 'setCurrentFile',
                    currentFileName: curFileName,
                    currentContent: content
                });
                this._pushContent(curFileName, content);
            }
        },

        // 推送当前数据到文件管理器并触发同步（镜像文件+当前学期文件）
        uploadData: function () {
            if (this._syncing) return;
            // 测试模式不同步，避免污染云端数据
            if (App.isTestMode()) return;
            // 没有账密就不同步
            if (!App.Auth.getUsername() || !App.Auth.getPassword()) return;
            this._syncing = true;

            // 先确保镜像文件内容是最新的，并推送
            var mirrorEntry = findIndexByName(MIRROR_FILE_NAME);
            if (mirrorEntry) {
                var mirrorData = App.Storage._getMirrorData();
                writeFileData(mirrorEntry.id, JSON.stringify(mirrorData));
                this._pushContent(MIRROR_FILE_NAME, readFileData(mirrorEntry.id) || '');
            }

            // 确保当前学期文件内容是最新的，并推送
            var curFileName = this.getCurrentEditFileName();
            var curEntry = findIndexByName(curFileName);
            if (curEntry) {
                var curSem = App.Semester.getCurrentSemester();
                if (curSem) {
                    var semData = App.Storage._getSemesterData(curSem.id);
                    writeFileData(curEntry.id, JSON.stringify(semData));
                }
                this._pushContent(curFileName, readFileData(curEntry.id) || '');
            }
            this.postMsg({ type: 'syncAllFiles' });
            App.Toast.show('正在同步...', 'info');
        },

        // 从云端同步数据（双向：推送本地内容 + 触发管理器全量同步）
        syncData: function () {
            if (this._syncing) return;
            // 没有账密就不同步
            if (!App.Auth.getUsername() || !App.Auth.getPassword()) return;
            this._syncing = true;

            // 镜像文件内容先落盘
            var mirrorEntry = findIndexByName(MIRROR_FILE_NAME);
            if (mirrorEntry) {
                var mirrorData = App.Storage._getMirrorData();
                writeFileData(mirrorEntry.id, JSON.stringify(mirrorData));
            }
            // 当前学期文件内容先落盘
            var curFileName = this.getCurrentEditFileName();
            var curEntry = findIndexByName(curFileName);
            if (curEntry) {
                var curSem = App.Semester.getCurrentSemester();
                if (curSem) {
                    var semData = App.Storage._getSemesterData(curSem.id);
                    writeFileData(curEntry.id, JSON.stringify(semData));
                }
            }
            this.pushAllLocalFiles();
            this.postMsg({ type: 'syncAllFiles' });
            App.Toast.show('正在同步...', 'info');
        },

        // 同步所有文件
        syncAll: function () {
            this.pushAllLocalFiles();
            this.postMsg({ type: 'syncAllFiles' });
            App.Toast.show('正在全量同步...', 'info');
        },

        // 注册镜像文件（首次使用，需确认云端无此文件）
        registerMirrorFile: function () {
            var mirrorEntry = findIndexByName(MIRROR_FILE_NAME);
            if (!mirrorEntry) {
                App.Storage._ensureMirrorFile();
                mirrorEntry = findIndexByName(MIRROR_FILE_NAME);
            }
            if (mirrorEntry) {
                var content = readFileData(mirrorEntry.id) || '';
                this.postMsg({
                    type: 'registerNewFile',
                    name: MIRROR_FILE_NAME,
                    content: content
                });
            }
        },

        // 注册当前学期文件（需确认云端无此文件）
        registerCurrentSemesterFile: function () {
            var curSem = App.Semester.getCurrentSemester();
            if (!curSem) return;
            var fileName = getSemesterFileName(curSem.id);
            var entry = findIndexByName(fileName);
            if (!entry) {
                App.Storage._ensureSemesterFile(curSem.id);
                entry = findIndexByName(fileName);
            }
            if (entry) {
                var content = readFileData(entry.id) || '';
                this.postMsg({
                    type: 'registerNewFile',
                    name: fileName,
                    content: content
                });
            }
        },

        // 登录后检查云端文件，决定是下载还是新建
        checkCloudAndInit: function () {
            var self = this;
            // 通知管理器宿主已就绪：触发其登录同步（拉取云端文件索引）
            this.postMsg({ type: 'mainReady' });
            // 兜底：稍后执行一次云端检查（正常情况下由 syncComplete 触发）
            setTimeout(function () {
                self._doCloudCheck();
            }, 4000);
        },

        // 云端检查：确保镜像文件与当前学期文件就位（云端有则下载，都没有则创建）
        _doCloudCheck: function () {
            this._ensureOrPull(MIRROR_FILE_NAME);
            var curSem = App.Semester.getCurrentSemester();
            if (curSem) {
                this._ensureOrPull(getSemesterFileName(curSem.id));
            }
        },

        // 同步完成后：拉取本地缺失内容的镜像/当前学期文件
        _afterSyncPull: function () {
            this._doCloudCheck();
        },

        // 确保某文件内容就位：云端有则下载，本地云端都没有则创建
        _ensureOrPull: function (fileName) {
            var entry = findIndexByName(fileName);
            var hasLocal = entry ? !!readFileData(entry.id) : false;
            if (entry && entry.id && (entry.cloudOnly || !hasLocal)) {
                // 云端有、本地无内容 → 下载
                this.postMsg({ type: 'downloadCloudFile', fileId: entry.id, fileName: fileName });
            } else if (!entry) {
                // 本地与云端都没有 → 创建并注册
                this._createMissingFile(fileName);
            }
            // 本地已有内容且非云端独占 → 无需处理，交由同步引擎按版本比对
        },

        // 处理来自文件管理器的消息
        handleMessage: function (msg) {
            // 测试模式：忽略所有云端同步消息，避免污染测试数据
            if (App.isTestMode()) {
                this._syncing = false;
                return;
            }
            switch (msg.type) {
                case 'openFile':
                    // 文件被打开，导入数据到对应文件
                    if (msg.name && msg.content) {
                        this._importFileContent(msg.name, msg.content);
                    }
                    this._syncing = false;
                    break;

                case 'openDenied':
                    // 本地和云端都没有此文件 → 自动创建
                    if (msg.reason === 'not_found_anywhere' && msg.name) {
                        this._createMissingFile(msg.name);
                    } else if (msg.reason === 'network_error') {
                        App.Toast.show('网络异常，无法打开文件', 'error');
                    } else {
                        App.Toast.show('无法打开文件：' + (msg.reason || '未知原因'), 'error');
                    }
                    this._syncing = false;
                    break;

                case 'fileContentUpdated':
                    // 云端内容更新（镜像文件会主动推送，普通文件按需下载）
                    if (msg.name && msg.content) {
                        this._importFileContent(msg.name, msg.content);
                    }
                    this._syncing = false;
                    break;

                case 'fileContentChanged':
                    if (msg.name && msg.content) {
                        this._importFileContent(msg.name, msg.content);
                    }
                    break;

                case 'fileDeleted':
                    App.Toast.show('文件已被删除：' + (msg.name || ''), 'warning');
                    break;

                case 'syncComplete':
                    // 同步完成（管理器已刷新云端索引）→ 重置同步态并检查需下载文件
                    this._syncing = false;
                    this._afterSyncPull();
                    break;

                case 'cloudIndexUpdated':
                    this._afterSyncPull();
                    break;

                case 'syncState':
                    var stateIcon = document.getElementById('btn-sync-icon');
                    if (stateIcon) {
                        stateIcon.textContent = msg.state === 'syncing' ? '⏳' : (msg.state === 'error' ? '⚠️' : '☁️');
                    }
                    if (msg.state !== 'syncing') this._syncing = false;
                    break;

                case 'contentSaved':
                case 'starChanged':
                    break;

                case 'closeFileManager':
                    this.closeManager();
                    break;

                case 'syncStatusChanged':
                    var syncBtn = document.getElementById('btn-sync-icon');
                    if (syncBtn) {
                        syncBtn.textContent = msg.icon || '☁️';
                    }
                    break;

                case 'syncConflict':
                    App.Toast.show('同步冲突，请在文件管理器中处理', 'warning');
                    this._syncing = false;
                    break;

                case 'conflictResolved':
                    App.Toast.show('冲突已解决', 'success');
                    this._syncing = false;
                    break;

                case 'syncToast':
                    App.Toast.show(msg.message || '', 'info');
                    if (msg.message && (msg.message.indexOf('上传') > -1 || msg.message.indexOf('同步') > -1 || msg.message.indexOf('完成') > -1)) {
                        this._syncing = false;
                    }
                    break;

                case 'registerResult':
                    if (msg.success) {
                        App.Toast.show('文件已注册到云端：' + (msg.name || ''), 'success');
                        // 注册成功后绑定ID到★系统设置
                        if (msg.id && msg.name) {
                            if (msg.name === MIRROR_FILE_NAME) {
                                App.Storage._bindMirrorFileId(msg.id);
                            } else {
                                // 查找对应的学期ID
                                for (var ri = 0; ri < PinyinData.semesters.length; ri++) {
                                    if (getSemesterFileName(PinyinData.semesters[ri].id) === msg.name) {
                                        App.Storage.setSemesterFileId(PinyinData.semesters[ri].id, msg.id);
                                        break;
                                    }
                                }
                            }
                        }
                    } else {
                        App.Toast.show('注册失败：' + (msg.message || ''), 'error');
                    }
                    this._syncing = false;
                    break;

                case 'importResult':
                    if (msg.success) {
                        App.Toast.show('数据已导入', 'success');
                    } else {
                        App.Toast.show('导入失败：' + (msg.message || ''), 'error');
                    }
                    this._syncing = false;
                    break;

                case 'syncSettingsChanged':
                    break;

                case 'allCloudDataDeleted':
                    // 兼容：云端数据清理完毕，现在清本地
                    if (this._resetFallbackTimer) {
                        clearTimeout(this._resetFallbackTimer);
                        this._resetFallbackTimer = null;
                    }
                    if (this._resetWaiting) {
                        this._resetWaiting = false;
                        App.Settings._doLocalReset();
                    }
                    break;

                default:
                    break;
            }
        },

        // 将云端下载的内容写入对应文件
        // 本地和云端都没有文件时，自动创建并发注册
        // ===== ★系统设置 相关方法（6.0：改为确保本地镜像并推送内容） =====

        // 确保★系统设置存在（首次登录时调用）
        ensureSystemSettings: function () {
            App.Storage._ensureMirrorFile();
            var entry = findIndexByName(MIRROR_FILE_NAME);
            if (entry) {
                var content = readFileData(entry.id) || '';
                if (content) this._pushContent(MIRROR_FILE_NAME, content);
            }
        },

        // 读取★系统设置（6.0 管理器无此消息，保留空实现兼容）
        readSystemSettings: function () {
        },

        // 写入★系统设置（6.0 管理器无此消息，保留空实现兼容）
        writeSystemSettings: function (settings) {
        },

        _createMissingFile: function (fileName) {
            var content = '';
            if (fileName === MIRROR_FILE_NAME) {
                // 镜像文件：检查本地永久绑定的ID
                var boundMirrorId = App.Storage.getBoundMirrorFileId();
                if (boundMirrorId) {
                    var mirrorEntry = findIndexById(boundMirrorId);
                    if (mirrorEntry) {
                        content = readFileData(boundMirrorId) || '';
                    }
                }
                if (!content) {
                    App.Storage._ensureMirrorFile();
                    var entry = findIndexByName(MIRROR_FILE_NAME);
                    if (entry) {
                        content = readFileData(entry.id) || '';
                    }
                }
            } else {
                // 学期文件：先查★系统设置里是否已绑定ID
                var semId = '';
                for (var i = 0; i < PinyinData.semesters.length; i++) {
                    if (getSemesterFileName(PinyinData.semesters[i].id) === fileName) {
                        semId = PinyinData.semesters[i].id;
                        break;
                    }
                }
                if (semId) {
                    var boundSemId = App.Storage.getSemesterFileId(semId);
                    if (boundSemId) {
                        // 已绑定ID → 只认这个ID，不新建
                        var semEntry = findIndexById(boundSemId);
                        if (semEntry) {
                            content = readFileData(boundSemId) || '';
                        }
                        // 本地没有绑定的文件 → 不新建，发注册请求让文件管理器处理
                        if (!content) {
                            console.log('[学期文件] ' + semId + ' 已绑定ID=' + boundSemId + '，本地缺失，发注册请求');
                            this.postMsg({
                                type: 'registerNewFile',
                                name: fileName,
                                content: ''
                            });
                            return;
                        }
                    } else {
                        // 未绑定ID → 走正常创建流程（_ensureSemesterFile会绑定）
                        App.Storage._ensureSemesterFile(semId);
                        var entry2 = findIndexByName(fileName);
                        if (entry2) {
                            content = readFileData(entry2.id) || '';
                        }
                    }
                }
            }
            if (content) {
                this.postMsg({
                    type: 'registerNewFile',
                    name: fileName,
                    content: content
                });
            }
        },

        _importFileContent: function (fileName, content) {
            if (!content) return;

            // 镜像文件：检查本地永久绑定的ID
            if (fileName === MIRROR_FILE_NAME) {
                var boundMirrorId = App.Storage.getBoundMirrorFileId();
                if (boundMirrorId) {
                    // 已绑定ID → 只认这个ID
                    var mirrorEntry = findIndexById(boundMirrorId);
                    if (!mirrorEntry) {
                        // 本地没有绑定的文件 → 用绑定的ID创建索引（不生成新ID）
                        var idx = getFileIndex();
                        idx.push({
                            name: MIRROR_FILE_NAME, id: boundMirrorId, version: 1,
                            lastSyncVersion: 0, isNewFile: false, folder: '', owner: '',
                            createTime: new Date().toLocaleString('zh-CN'),
                            lastUploadTime: '', lastEditTime: new Date().toLocaleString('zh-CN'),
                            contentLength: content.length
                        });
                        setFileIndex(idx);
                        localStorage.setItem(STORAGE_PREFIX + 'file_id_' + boundMirrorId, JSON.stringify({ data: content, view: null }));
                    }
                } else {
                    // 未绑定 → 创建并绑定
                    var entry = findIndexByName(fileName);
                    if (!entry) {
                        createFile(fileName, content);
                        entry = findIndexByName(fileName);
                    }
                    if (entry) App.Storage._bindMirrorFileId(entry.id);
                }
                try {
                    var data = JSON.parse(content);
                    if (data) {
                        if (data.feedbackFontSize) document.documentElement.style.setProperty('--feedback-answer-size', data.feedbackFontSize + 'px');
                        if (data.pinyinDisplaySize) document.documentElement.style.setProperty('--pinyin-display-size', data.pinyinDisplaySize + 'px');
                    }
                } catch (e) { /* 忽略解析错误 */ }
                App.Home.render();
                return;
            }

            // 学期文件：检查★系统设置里是否已绑定ID
            var semId = '';
            for (var i = 0; i < PinyinData.semesters.length; i++) {
                if (getSemesterFileName(PinyinData.semesters[i].id) === fileName) {
                    semId = PinyinData.semesters[i].id;
                    break;
                }
            }
            if (semId) {
                var boundSemId = App.Storage.getSemesterFileId(semId);
                if (boundSemId) {
                    // 已绑定ID → 只认这个ID，不是这个ID的不认不新建
                    var semEntry = findIndexById(boundSemId);
                    if (!semEntry) {
                        // 本地没有绑定的文件 → 用绑定的ID创建索引（不生成新ID）
                        var semIdx = getFileIndex();
                        semIdx.push({
                            name: fileName, id: boundSemId, version: 1,
                            lastSyncVersion: 0, isNewFile: false, folder: '', owner: '',
                            createTime: new Date().toLocaleString('zh-CN'),
                            lastUploadTime: '', lastEditTime: new Date().toLocaleString('zh-CN'),
                            contentLength: content.length
                        });
                        setFileIndex(semIdx);
                        localStorage.setItem(STORAGE_PREFIX + 'file_id_' + boundSemId, JSON.stringify({ data: content, view: null }));
                    }
                } else {
                    // 未绑定 → 创建并绑定
                    var entry2 = findIndexByName(fileName);
                    if (!entry2) {
                        createFile(fileName, content);
                        entry2 = findIndexByName(fileName);
                    }
                    if (entry2) App.Storage.setSemesterFileId(semId, entry2.id);
                }
                var curSem = App.Semester.getCurrentSemester();
                if (curSem && fileName === getSemesterFileName(curSem.id)) {
                    App.Home.render();
                }
                return;
            }

            // 非学期非镜像文件 → 正常处理
            var entry3 = findIndexByName(fileName);
            if (!entry3) {
                createFile(fileName, content);
            }
        },

        // 启动自动保存
        startAutoSave: function () {
            var self = this;
            this.stopAutoSave();
            // 测试模式不启动自动同步
            if (App.isTestMode()) return;
            var s = App.Storage.getSettings();
            var interval = (s.autoSaveInterval || 1) * 60000;
            this._autoSaveTimer = setInterval(function () {
                // 没有账密就停止自动同步
                if (!App.Auth.getUsername() || !App.Auth.getPassword()) {
                    self.stopAutoSave();
                    return;
                }
                if (!self._syncing) {
                    self.uploadData();
                }
            }, interval);
        },

        stopAutoSave: function () {
            if (this._autoSaveTimer) {
                clearInterval(this._autoSaveTimer);
                this._autoSaveTimer = null;
            }
        }
    };

    // 全屏切换
    App.toggleFullscreen = function () {
        var btn = document.getElementById('btn-fullscreen');
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            var el = document.documentElement;
            if (el.requestFullscreen) el.requestFullscreen();
            else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
        } else {
            if (document.exitFullscreen) document.exitFullscreen();
            else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        }
    };

    // 全局消息监听器（必须在最外层注册）
    window.addEventListener('message', function (e) {
        if (!e.data || typeof e.data !== 'object') return;
        var msg = e.data;
        if (!msg.type) return;

        // 处理登录iframe发来的登录成功消息
        if (msg.type === 'loginSuccess') {
            if (msg.username && msg.password) {
                App.Auth.onLoginSuccess(msg.username, msg.password);
            }
            return;
        }

        // 修改密码成功
        if (msg.type === 'passwordChanged') {
            if (msg.username && msg.newPassword) {
                localStorage.setItem(App.Auth.STORAGE_KEY_PASS, msg.newPassword);
                App.Auth.syncAuthToFileManager();
                App.Toast.show('密码已更新', 'success');
            }
            return;
        }

        // 分发给FileSync处理
        if (App.FileSync) {
            App.FileSync.handleMessage(msg);
        }
    });

    // ===== 初始化 =====
    App.init = function () {
        App.Sound.init();
        App.FX.init();
        App.Tooltip.init();
        App.FileSync.initFrame();
        App.Exam._loadOptionFontSize();

        // 检查独立登录回跳：denglu.html?standalone=1 登录成功后会设此标记
        if (localStorage.getItem('PINYINLIANXI_standalone_just_logged') === '1') {
            localStorage.removeItem('PINYINLIANXI_standalone_just_logged');
            // 直接初始化主应用
            App._initMainApp();
            App.Toast.show('欢迎，' + App.Auth.getUsername(), 'success');
            return;
        }

        // 检查登录状态
        if (!App.Auth.checkAuth()) {
            // 未登录，显示登录弹窗，首页作为背景
            App.switchView('home');
            return;
        }

        // 已登录，初始化主应用
        App._initMainApp();
    };

    // 主应用初始化标记
    App._mainAppInitialized = false;

    // 主应用初始化（登录后调用）
    App._initMainApp = function () {
        if (App._mainAppInitialized) return;
        App._mainAppInitialized = true;

        // 从旧格式迁移数据到新格式（如果需要）
        App.Storage.migrateFromOldFormat();
        // 确保所有必要文件存在
        App.Storage.initFiles();

        // 检测未完成的重新挑战（应用中途退出/刷新）：恢复原数据
        var pendingRechallenge = App.Semester.getActiveRechallenge();
        if (pendingRechallenge) {
            App.Semester.cancelRechallenge();
            // 同时清除可能残留的考试进度（防止恢复到中途的考试状态）
            App.Storage.setExamProgress(null);
            console.log('[Rechallenge] 检测到未完成的重新挑战，已恢复原数据：' +
                pendingRechallenge.semesterId + ' / ' + pendingRechallenge.difficulty);
            setTimeout(function () {
                App.Toast.show('上次重新挑战未完成，原数据已恢复', 'info');
            }, 500);
        }

        // 应用保存的字体大小设置
        var s = App.Storage.getSettings();
        if (s.feedbackFontSize) document.documentElement.style.setProperty('--feedback-answer-size', s.feedbackFontSize + 'px');
        if (s.pinyinDisplaySize) document.documentElement.style.setProperty('--pinyin-display-size', s.pinyinDisplaySize + 'px');
        // 显示首页
        App.switchView('home');
        // 预加载当前学期数据
        var curSem = App.Semester.getCurrentSemester();
        PinyinData.loadSemester(curSem.id, function () {
            // 数据加载完成后刷新首页
            App.Home.render();
        });
        // 云同步始终开启，启动自动保存
        App.FileSync.startAutoSave();
        // 传递认证信息到文件管理器
        App.Auth.syncAuthToFileManager();
    };

    // DOM Ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', App.init);
    } else {
        App.init();
    }

})();
