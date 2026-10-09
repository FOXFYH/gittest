// 拼音练习 - 字库数据（核心框架）
// 各学期字库数据按需加载，存放在 data/ 目录下
// 每个字: { char, pinyin, errorLevel(易错等级0/1/2/3) }
// errorLevel: 0=普通, 1=易错(+100%概率), 2=较易错(+200%概率), 3=极易错(+400%概率)
// 易错依据: b/d/p/q混淆, n/l混淆, z/c/s与zh/ch/sh混淆, 前后鼻音混淆, ie/ei混淆, iu/ui混淆, j/q/x与ü规则

var PinyinData = {

  initials: ['b','c','ch','d','f','g','h','j','k','l','m','n','p','q','r','s','sh','t','w','x','y','z','zh'],
  medials: ['i','u','ü'],
  // 可分解的韵母：含介母的三拼音节
  // 注：üe/üan 是完整复韵母，不能拆分为介母+韵母
  FINAL_DECOMPOSE: {
    'ia': { medial: 'i', final: 'a' },
    'ian': { medial: 'i', final: 'an' },
    'iang': { medial: 'i', final: 'ang' },
    'iao': { medial: 'i', final: 'ao' },
    'iong': { medial: 'i', final: 'ong' },
    'ua': { medial: 'u', final: 'a' },
    'uai': { medial: 'u', final: 'ai' },
    'uan': { medial: 'u', final: 'an' },
    'uang': { medial: 'u', final: 'ang' },
    'uo': { medial: 'u', final: 'o' }
    // 注：üan 在 jqxy 后虽写作 uan，但发音仍是 üan（整体复韵母），不拆分
  },
  // 基础韵母（去除介母后的韵母选项），按 a→e→i→o→u→ü 排列
  // 含 üe/üan 整体复韵母（不拆分）
  baseFinals: ['a','ai','an','ang','ao','e','ei','en','eng','er','ie','i','in','ing','o','ong','ou','iu','u','un','ui','ü','üe','üan','ün'],
  finals: ['a','ai','an','ang','ao','e','ei','en','eng','er','ie','i','in','ing','o','ong','ou','iu','u','un','ui','ü','ün','üe'],
  wholeSyllables: ['zhi','chi','shi','ri','zi','ci','si','yi','wu','yu','ye','yue','yuan','yin','yun','ying'],
  // 相似整体认读音节分组，用于生成干扰选项
  wholeSyllableGroups: [
    ['zhi','chi','shi','ri','zi','ci','si'],    // 卷舌/平舌组
    ['yi','yu','ye','yue','yuan','yin','yun','ying'], // y系组
    ['wu']                                       // w系
  ],

  tones: [
    { id: 1, name: '第一声', symbol: 'ˉ' },
    { id: 2, name: '第二声', symbol: 'ˊ' },
    { id: 3, name: '第三声', symbol: 'ˇ' },
    { id: 4, name: '第四声', symbol: 'ˋ' }
  ],

  semesters: [
    { id: '1a', name: '一年级上学期' },
    { id: '1b', name: '一年级下学期' },
    { id: '2a', name: '二年级上学期' },
    { id: '2b', name: '二年级下学期' },
    { id: '3a', name: '三年级上学期' },
    { id: '3b', name: '三年级下学期' },
    { id: '4a', name: '四年级上学期' },
    { id: '4b', name: '四年级下学期' },
    { id: '5a', name: '五年级上学期' },
    { id: '5b', name: '五年级下学期' },
    { id: '6a', name: '六年级上学期' },
    { id: '6b', name: '六年级下学期' }
  ],

  // 解析拼音，返回声母、介母、韵母、声调
  parsePinyin: function(pinyin) {
    var tone = 0;
    var toneMap = {'ā':1,'á':2,'ǎ':3,'à':4,'ō':1,'ó':2,'ǒ':3,'ò':4,
      'ē':1,'é':2,'ě':3,'è':4,'ī':1,'í':2,'ǐ':3,'ì':4,
      'ū':1,'ú':2,'ǔ':3,'ù':4,'ǖ':1,'ǘ':2,'ǚ':3,'ǜ':4};
    var baseMap = {'ā':'a','á':'a','ǎ':'a','à':'a','ō':'o','ó':'o','ǒ':'o','ò':'o',
      'ē':'e','é':'e','ě':'e','è':'e','ī':'i','í':'i','ǐ':'i','ì':'i',
      'ū':'u','ú':'u','ǔ':'u','ù':'u','ǖ':'v','ǘ':'v','ǚ':'v','ǜ':'v'};
    var base = '';
    for (var i = 0; i < pinyin.length; i++) {
      var ch = pinyin[i];
      if (toneMap[ch]) { tone = toneMap[ch]; base += baseMap[ch]; }
      else base += ch;
    }
    base = base.replace(/v/g, 'ü');
    if (this.wholeSyllables.indexOf(base) >= 0) {
      return { initial: '', medial: '', final: base, tone: tone, isWhole: true, base: base };
    }
    var initial = '', final_ = base;
    if (base.indexOf('zh')===0) { initial='zh'; final_=base.substring(2); }
    else if (base.indexOf('ch')===0) { initial='ch'; final_=base.substring(2); }
    else if (base.indexOf('sh')===0) { initial='sh'; final_=base.substring(2); }
    else if ('bpmfdtnlgkhjqxrzcsyw'.indexOf(base[0])>=0) { initial=base[0]; final_=base.substring(1); }

    // 介母分解：检查韵母是否可分解
    var medial = '';
    var decomp = null;
    // j/q/x/y 后的 u 实际是 ü（拼写规则省略两点）：ue→üe, uan→üan, u→ü
    // 但 üe 和 üan 是完整复韵母，不拆分为介母+韵母
    if (initial && 'jqxy'.indexOf(initial) >= 0) {
      if (final_ === 'ue') final_ = 'üe';      // 例：学 xué → x + üe（无介母）
      else if (final_ === 'uan') final_ = 'üan'; // 例：卷 juǎn → j + üan（无介母）
      else if (final_ === 'u') final_ = 'ü';     // 例：女 nǚ（仅 n/l 后保留两点，jqxy 后写作 u）
    }
    // 普通分解（仅对真正的三拼音节）
    decomp = this.FINAL_DECOMPOSE[final_];
    if (decomp) {
      medial = decomp.medial;
      final_ = decomp.final;
    }

    return { initial: initial, medial: medial, final: final_, tone: tone, isWhole: false, base: base };
  },

  // 给拼音加声调
  addTone: function(base, tone) {
    if (!tone) return base;
    var tm = {'a':['ā','á','ǎ','à'],'o':['ō','ó','ǒ','ò'],'e':['ē','é','ě','è'],
      'i':['ī','í','ǐ','ì'],'u':['ū','ú','ǔ','ù'],'ü':['ǖ','ǘ','ǚ','ǜ']};
    var r = base;
    var ai = r.indexOf('a'); if(ai>=0) return r.substring(0,ai)+tm['a'][tone-1]+r.substring(ai+1);
    var oi = r.indexOf('o'); if(oi>=0) return r.substring(0,oi)+tm['o'][tone-1]+r.substring(oi+1);
    var ei = r.indexOf('e'); if(ei>=0) return r.substring(0,ei)+tm['e'][tone-1]+r.substring(ei+1);
    var iui = r.indexOf('iu'); if(iui>=0) return r.substring(0,iui+1)+tm['u'][tone-1]+r.substring(iui+2);
    var uii = r.indexOf('ui'); if(uii>=0) return r.substring(0,uii+1)+tm['i'][tone-1]+r.substring(uii+2);
    for(var i=r.length-1;i>=0;i--){var c=r[i];if(tm[c]) return r.substring(0,i)+tm[c][tone-1]+r.substring(i+1);}
    return r;
  },

  // 获取韵母中的元音字母列表（用于标调位置选择）
  getToneVowels: function(baseStr) {
    var vowels = [];
    for (var i = 0; i < baseStr.length; i++) {
      var ch = baseStr[i];
      if ('aeiouü'.indexOf(ch) >= 0) {
        vowels.push({ char: ch, index: i });
      }
    }
    return vowels;
  },

  // 获取标调位置（返回元音在字符串中的索引）
  getTonePosition: function(baseStr) {
    // 规则与addTone一致：a > o/e > iu(标u) > ui(标i) > 最后元音
    var ai = baseStr.indexOf('a'); if (ai >= 0) return ai;
    var oi = baseStr.indexOf('o'); if (oi >= 0) return oi;
    var ei = baseStr.indexOf('e'); if (ei >= 0) return ei;
    var iui = baseStr.indexOf('iu'); if (iui >= 0) return iui + 1; // 标在u上
    var uii = baseStr.indexOf('ui'); if (uii >= 0) return uii + 1; // 标在i上
    // 标在最后一个元音上
    for (var i = baseStr.length - 1; i >= 0; i--) {
      if ('aeiouü'.indexOf(baseStr[i]) >= 0) return i;
    }
    return -1;
  },

  formatPinyin: function(initial, medial, final_, tone) {
    var baseFinal = (medial || '') + final_;
    var result = (initial || '') + this.addTone(baseFinal, tone);
    // j/q/x/y 后的 ü 写成 u（省略两点规则），含带调形式
    if (initial && 'jqxy'.indexOf(initial) >= 0) {
      result = result.replace(/ü/g, 'u')
                     .replace(/ǖ/g, 'ū').replace(/ǘ/g, 'ú')
                     .replace(/ǚ/g, 'ǔ').replace(/ǜ/g, 'ù');
    }
    return result;
  },

  // ===== 按需加载系统 =====
  // 各学期生字数据（初始为空，按需加载）
  chars: {},

  // 多音字备选读音表（char -> [altPinyin, ...]，主拼音已在学期数据中）
  polyphones: {},

  // 已加载的学期记录
  _loaded: {},

  // 加载中的回调队列
  _loadingCallbacks: {},

  // 注册多音字备选读音（由 polyphones.js 调用）
  registerPolyphones: function(map) {
    var self = this;
    Object.keys(map).forEach(function (ch) {
      self.polyphones[ch] = map[ch];
    });
  },

  // 取得一个字的完整合法读音数组（主拼音 + 备选）
  getAllPinyin: function (char) {
    var self = this;
    // 从学期数据找主拼音
    var primary = null;
    Object.keys(this.chars).forEach(function (sid) {
      if (primary) return;
      var arr = self.chars[sid];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].char === char) { primary = arr[i].pinyin; break; }
      }
    });
    var result = primary ? [primary] : [];
    if (this.polyphones[char]) {
      result = result.concat(this.polyphones[char]);
    }
    return result;
  },

  // 注册学期数据（由各学期数据文件调用）
  registerSemester: function(semesterId, charArray) {
    // 合并多音字备选读音到每个字符的 altPinyin 字段
    for (var i = 0; i < charArray.length; i++) {
      var ch = charArray[i].char;
      if (this.polyphones[ch]) {
        charArray[i].altPinyin = this.polyphones[ch].slice();
      }
    }
    this.chars[semesterId] = charArray;
    this._loaded[semesterId] = true;
    // 触发等待中的回调
    if (this._loadingCallbacks[semesterId]) {
      var callbacks = this._loadingCallbacks[semesterId];
      delete this._loadingCallbacks[semesterId];
      for (var i = 0; i < callbacks.length; i++) {
        try { callbacks[i](charArray); } catch (e) {}
      }
    }
  },

  // 检查学期数据是否已加载
  isLoaded: function(semesterId) {
    return !!this._loaded[semesterId];
  },

  // 按需加载学期数据
  loadSemester: function(semesterId, callback) {
    // 已加载，直接回调
    if (this._loaded[semesterId]) {
      if (callback) callback(this.chars[semesterId]);
      return;
    }
    // 加入等待队列
    if (!this._loadingCallbacks[semesterId]) {
      this._loadingCallbacks[semesterId] = [];
    }
    if (callback) {
      this._loadingCallbacks[semesterId].push(callback);
    }
    // 动态创建script标签加载
    if (!this._loadingCallbacks[semesterId]._scriptCreated) {
      this._loadingCallbacks[semesterId]._scriptCreated = true;
      var script = document.createElement('script');
      // 使用当前页面所在目录作为基准，兼容 GitHub Pages 子目录部署
      var baseUrl = (document.currentScript && document.currentScript.src)
        ? document.currentScript.src.replace(/[^/]*$/, '')
        : '';
      script.src = baseUrl + 'data/' + semesterId + '.js';
      script.onerror = function() {
        console.error('加载学期数据失败: ' + semesterId);
        var cbs = PinyinData._loadingCallbacks[semesterId];
        delete PinyinData._loadingCallbacks[semesterId];
        if (cbs) {
          for (var i = 0; i < cbs.length; i++) {
            try { cbs[i](null); } catch (e) {}
          }
        }
      };
      document.head.appendChild(script);
    }
  },

  // 批量加载多个学期数据
  loadSemesters: function(semesterIds, callback) {
    var total = semesterIds.length;
    if (total === 0) { if (callback) callback(); return; }
    var loaded = 0;
    var failed = false;
    semesterIds.forEach(function(id) {
      PinyinData.loadSemester(id, function() {
        loaded++;
        if (loaded >= total && !failed && callback) callback();
      });
    });
  },

  // 获取学期字数（无需加载数据）
  getSemesterCharCount: function(semesterId) {
    if (this._loaded[semesterId] && this.chars[semesterId]) {
      var count = this.chars[semesterId].length;
      // 测试模式：每学期最多 4 字
      if (typeof App !== 'undefined' && App.isTestMode && App.isTestMode()) {
        return Math.min(4, count);
      }
      return count;
    }
    return 0;
  }
};
