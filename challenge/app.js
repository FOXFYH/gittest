(function () {
    'use strict';
    var App = window.App = {};
    function genId(){return Date.now().toString(36)+Math.random().toString(36).substr(2,6)}
    // 题库专用ID：QB_ + 10位数字，与云端格式一致
    function genBankId(){return 'QB_'+Math.floor(Math.random()*9000000000+1000000000)}
    function shuffle(arr){var a=arr.slice();for(var i=a.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=a[i];a[i]=a[j];a[j]=t}return a}
    function getAvatarChar(name,usedChars){
        if(!name)return'?';
        var last=name.charAt(name.length-1);
        if(!usedChars||!usedChars[last])return last;
        for(var i=name.length-2;i>=1;i--){
            var ch=name.charAt(i);
            if(!usedChars[ch])return ch;
        }
        var first=name.charAt(0);
        if(!usedChars[first])return first;
        return last;
    }
    function buildAvatarCharMap(students){
        var used={},result={};
        var sorted=students.slice().sort(function(a,b){return a.name.length-b.name.length});
        sorted.forEach(function(s){
            if(s.avatar)return;
            var ch=getAvatarChar(s.name,used);
            result[s.id]=ch;
            used[ch]=true;
        });
        return result;
    }

    var DEFAULT_STUDENTS = DemoData.students;
    var DEFAULT_BANKS = DemoData.banks;

    var DATA_VERSION = 5;

    App.Storage = {
        get:function(k,d){try{var v=localStorage.getItem('exam_'+k);return v?JSON.parse(v):d}catch(e){return d}},
        set:function(k,v){try{localStorage.setItem('exam_'+k,JSON.stringify(v))}catch(e){}},
        ensureDefaults:function(){
            var ver=this.get('dataVersion',0);
            if(ver<DATA_VERSION){
                var students=this.get('students',null);
                if(!students||students.length===0){this.setStudents(DEFAULT_STUDENTS)}
                else{
                    var changed=false;
                    students.forEach(function(s){
                        if(s.gender===undefined){s.gender='';changed=true}
                        if(s.group===undefined){s.group='';changed=true}
                        if(s.totalPoints!==undefined){delete s.totalPoints;changed=true}
                    });
                    if(changed)this.setStudents(students);
                }
                var banks=this.get('banks',null);
                if(!banks||banks.length===0){this.setBanks(DEFAULT_BANKS.slice())}
                this.set('dataVersion',DATA_VERSION);
                localStorage.removeItem('exam_pointsCache');
            }
        },
        getStudents:function(){return this.get('students',[])},
        setStudents:function(s){var hasReal=s.some(function(x){return!x._demo});if(hasReal){s=s.filter(function(x){return!x._demo})}this.set('students',s);if(!this._syncSilent)App.Sync.notifyChange('students',s)},
        getBanks:function(){return this.get('banks',[])},
        setBanks:function(b){var hasReal=b.some(function(x){return!x._demo});if(hasReal){b=b.filter(function(x){return!x._demo})}this.set('banks',b);if(!this._syncSilent)App.Sync.notifyChange('banks',b)},
        getRecords:function(){return this.get('records',[])},
        setRecords:function(r){this.set('records',r);if(!this._syncSilent)App.Sync.notifyChange('records',r)},
        getExamProgress:function(){return this.get('examProgress',null)},
        setExamProgress:function(p){this.set('examProgress',p)},
        clearExamProgress:function(){localStorage.removeItem('exam_examProgress')},
        getWrongSets:function(){return this.get('wrongSets',{})},
        setWrongSets:function(w){this.set('wrongSets',w)},
        getWrongSet:function(studentId,bankId){var all=this.getWrongSets();return all[studentId+'_'+bankId]||null},
        setWrongSet:function(studentId,bankId,data){var all=this.getWrongSets();all[studentId+'_'+bankId]=data;this.setWrongSets(all)},
        clearWrongSet:function(studentId,bankId){var all=this.getWrongSets();delete all[studentId+'_'+bankId];this.setWrongSets(all)},
        getAbsences:function(){return this.get('absences',{})},
        setAbsences:function(a){this.set('absences',a)},
        getAbsence:function(studentId){var all=this.getAbsences();return all[studentId]||null},
        setAbsence:function(studentId,data){var all=this.getAbsences();all[studentId]=data;this.setAbsences(all)},
        clearAbsence:function(studentId){var all=this.getAbsences();delete all[studentId];this.setAbsences(all)},
        getSettings:function(){
            return this.get('settings',{
                levels:[
                    {name:'新手',minPoints:0,comment:'初出茅庐，继续加油！'},
                    {name:'学徒',minPoints:100,comment:'小有所成，前途无量！'},
                    {name:'熟手',minPoints:300,comment:'技艺精湛，令人佩服！'},
                    {name:'专家',minPoints:600,comment:'学识渊博，无人能敌！'},
                    {name:'大师',minPoints:1000,comment:'登峰造极，一代宗师！'}
                ],
                aiApiUrl:'https://open.bigmodel.cn/api/paas/v4/chat/completions',aiApiKey:'a2c7cedcd0c64b74abf9967d85ba3d4c.lRKWx5uvKXz7Gn6B',aiModel:'glm-4.7-flash',
                soundEnabled:true,soundVolume:70,
                shuffleOptions:true,baseTimeout:30,charTimeoutCompensation:0.2,autoNext:true,drawAnimation:true,drawDuration:3
            });
        },
        setSettings:function(s){
            var oldSettings=this.getSettings();
            var oldLevels=oldSettings.levels;
            var oldAiConfig={aiApiUrl:oldSettings.aiApiUrl,aiApiKey:oldSettings.aiApiKey,aiModel:oldSettings.aiModel};
            this.set('settings',s);
            if(!this._syncSilent){
                var newLevels=s&&s.levels;
                var newAiConfig=s?{aiApiUrl:s.aiApiUrl,aiApiKey:s.aiApiKey,aiModel:s.aiModel}:null;
                if(JSON.stringify(oldLevels)!==JSON.stringify(newLevels)&&newLevels){
                    App.Sync.notifyChange('levels',newLevels);
                }
                if(JSON.stringify(oldAiConfig)!==JSON.stringify(newAiConfig)&&newAiConfig){
                    App.Sync.notifyChange('aiConfig',newAiConfig);
                }
            }
        },
        getGroups:function(){
            var students=this.getStudents();
            var groups={};
            students.forEach(function(s){if(s.group&&s.group.trim())groups[s.group.trim()]=true});
            return Object.keys(groups).sort();
        }
    };

    function getLevel(pts){
        var lvls=App.Storage.getSettings().levels||[];
        var r={name:'新手',comment:'初出茅庐，继续加油！'};
        for(var i=lvls.length-1;i>=0;i--){if(pts>=lvls[i].minPoints){r={name:lvls[i].name,comment:lvls[i].comment};break}}
        return r;
    }

    function getStudentStats(studentId){
        var records=App.Storage.getRecords();
        var totalPoints=0,totalCorrect=0,totalCount=0,sessions=0;
        records.forEach(function(rec){
            var srs=rec.studentResults||{};
            var sr=srs[studentId];
            if(sr){
                totalPoints+=sr.pointsEarned||0;
                totalCorrect+=sr.correctCount||0;
                totalCount+=sr.totalCount||0;
                sessions++;
            }else if(rec.allParticipants){
                // 全员参与但不在studentResults中 = 参与了但未被抽中答题
                sessions++;
            }
        });
        return{totalPoints:totalPoints,totalCorrect:totalCorrect,totalCount:totalCount,sessions:sessions,accuracy:totalCount>0?Math.round(totalCorrect/totalCount*100):0};
    }

    function getAllStudentStats(){
        var students=App.Storage.getStudents();
        var records=App.Storage.getRecords();
        var statsMap={};
        students.forEach(function(s){statsMap[s.id]={totalPoints:0,totalCorrect:0,totalCount:0,sessions:0}});
        records.forEach(function(rec){
            var srs=rec.studentResults||{};
            Object.keys(srs).forEach(function(sid){
                if(statsMap[sid]){
                    statsMap[sid].totalPoints+=srs[sid].pointsEarned||0;
                    statsMap[sid].totalCorrect+=srs[sid].correctCount||0;
                    statsMap[sid].totalCount+=srs[sid].totalCount||0;
                    statsMap[sid].sessions++;
                }
            });
            // 全员参与时，不在studentResults中的学生也算参与了1场
            if(rec.allParticipants){
                students.forEach(function(s){
                    if(!srs[s.id]&&statsMap[s.id]){
                        statsMap[s.id].sessions++;
                    }
                });
            }
        });
        Object.keys(statsMap).forEach(function(sid){
            var st=statsMap[sid];
            st.accuracy=st.totalCount>0?Math.round(st.totalCorrect/st.totalCount*100):0;
        });
        return statsMap;
    }

    App.Effects = {
        audioCtx:null,soundEnabled:true,volume:0.7,bgParticles:[],confetti:[],
        init:function(){
            var s=App.Storage.getSettings();this.soundEnabled=s.soundEnabled!==false;
            this.volume=(s.soundVolume||70)/100;this.initBgCanvas();this.initFxCanvas();this.updateSoundToggle();
        },
        getAudioCtx:function(){if(!this.audioCtx)this.audioCtx=new(window.AudioContext||window.webkitAudioContext)();return this.audioCtx},
        toggleSound:function(){this.soundEnabled=!this.soundEnabled;var s=App.Storage.getSettings();s.soundEnabled=this.soundEnabled;App.Storage.setSettings(s);this.updateSoundToggle();if(this.soundEnabled)this.playClick()},
        updateSoundToggle:function(){var el=document.getElementById('sound-toggle');if(el)el.textContent=this.soundEnabled?'🔊':'🔇'},
        playTone:function(freq,dur,type,vol){if(!this.soundEnabled)return;try{var ctx=this.getAudioCtx(),osc=ctx.createOscillator(),g=ctx.createGain();osc.type=type||'sine';osc.frequency.value=freq;g.gain.value=(vol||0.3)*this.volume;g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+dur);osc.connect(g);g.connect(ctx.destination);osc.start(ctx.currentTime);osc.stop(ctx.currentTime+dur)}catch(e){}},
        playClick:function(){this.playTone(800,0.08,'square',0.15)},
        playDrumRoll:function(){if(!this.soundEnabled)return;try{var ctx=this.getAudioCtx(),count=0;var iv=setInterval(function(){if(count>20){clearInterval(iv);return}var o=ctx.createOscillator(),g=ctx.createGain();o.type='triangle';o.frequency.value=200+Math.random()*100;g.gain.value=0.15*App.Effects.volume;g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.05);o.connect(g);g.connect(ctx.destination);o.start(ctx.currentTime);o.stop(ctx.currentTime+0.05);count++},60)}catch(e){}},
        playFanfare:function(){if(!this.soundEnabled)return;var self=this;[523,659,784,1047].forEach(function(f,i){setTimeout(function(){self.playTone(f,0.3,'sine',0.25)},i*120)})},
        playCorrect:function(){if(!this.soundEnabled)return;var self=this;self.playTone(880,0.15,'sine',0.3);setTimeout(function(){self.playTone(1175,0.25,'sine',0.3)},120)},
        playWrong:function(){this.playTone(200,0.4,'sawtooth',0.2)},
        playCountdown:function(){this.playTone(440,0.1,'sine',0.15)},
        playTimeUp:function(){if(!this.soundEnabled)return;var self=this;self.playTone(300,0.3,'sawtooth',0.25);setTimeout(function(){self.playTone(200,0.5,'sawtooth',0.25)},200)},
        playVictory:function(){if(!this.soundEnabled)return;var self=this;var notes=[523,659,784,1047,784,1047];notes.forEach(function(f,i){setTimeout(function(){self.playTone(f,0.25,'sine',0.3)},i*150)})},
        initBgCanvas:function(){var canvas=document.getElementById('bg-canvas');if(!canvas)return;var ctx=canvas.getContext('2d'),self=this;function resize(){canvas.width=window.innerWidth;canvas.height=window.innerHeight}resize();window.addEventListener('resize',resize);self.bgParticles=[];for(var i=0;i<60;i++){self.bgParticles.push({x:Math.random()*canvas.width,y:Math.random()*canvas.height,r:Math.random()*2+0.5,dx:(Math.random()-0.5)*0.5,dy:(Math.random()-0.5)*0.5,alpha:Math.random()*0.5+0.1,color:['108,92,231','168,85,247','6,182,212','244,114,182'][Math.floor(Math.random()*4)]})}function animate(){ctx.clearRect(0,0,canvas.width,canvas.height);var grad=ctx.createRadialGradient(canvas.width/2,canvas.height/2,0,canvas.width/2,canvas.height/2,canvas.width*0.7);grad.addColorStop(0,'rgba(20,20,50,0.3)');grad.addColorStop(1,'rgba(10,10,26,0.1)');ctx.fillStyle=grad;ctx.fillRect(0,0,canvas.width,canvas.height);self.bgParticles.forEach(function(p){p.x+=p.dx;p.y+=p.dy;if(p.x<0)p.x=canvas.width;if(p.x>canvas.width)p.x=0;if(p.y<0)p.y=canvas.height;if(p.y>canvas.height)p.y=0;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fillStyle='rgba('+p.color+','+p.alpha+')';ctx.fill();ctx.beginPath();ctx.arc(p.x,p.y,p.r*3,0,Math.PI*2);ctx.fillStyle='rgba('+p.color+','+(p.alpha*0.15)+')';ctx.fill()});for(var i=0;i<self.bgParticles.length;i++){for(var j=i+1;j<self.bgParticles.length;j++){var dx=self.bgParticles[i].x-self.bgParticles[j].x;var dy=self.bgParticles[i].y-self.bgParticles[j].y;var dist=Math.sqrt(dx*dx+dy*dy);if(dist<150){ctx.beginPath();ctx.moveTo(self.bgParticles[i].x,self.bgParticles[i].y);ctx.lineTo(self.bgParticles[j].x,self.bgParticles[j].y);ctx.strokeStyle='rgba(108,92,231,'+(0.08*(1-dist/150))+')';ctx.lineWidth=0.5;ctx.stroke()}}}requestAnimationFrame(animate)}animate()},
        initFxCanvas:function(){var canvas=document.getElementById('fx-canvas');if(!canvas)return;var ctx=canvas.getContext('2d'),self=this;function resize(){canvas.width=window.innerWidth;canvas.height=window.innerHeight}resize();window.addEventListener('resize',resize);self.confetti=[];function animate(){ctx.clearRect(0,0,canvas.width,canvas.height);self.confetti=self.confetti.filter(function(c){return c.life>0});self.confetti.forEach(function(c){c.x+=c.vx;c.y+=c.vy;c.vy+=0.15;c.rotation+=c.rotSpeed;c.life-=1;var alpha=Math.min(1,c.life/30);ctx.save();ctx.translate(c.x,c.y);ctx.rotate(c.rotation*Math.PI/180);ctx.fillStyle=c.color.replace('1)',alpha+')');ctx.fillRect(-c.w/2,-c.h/2,c.w,c.h);ctx.restore()});requestAnimationFrame(animate)}animate()},
        spawnConfetti:function(x,y,count){count=count||50;var colors=['rgba(108,92,231,1)','rgba(168,85,247,1)','rgba(6,182,212,1)','rgba(244,114,182,1)','rgba(251,191,36,1)','rgba(34,197,94,1)','rgba(239,68,68,1)','rgba(59,130,246,1)'];for(var i=0;i<count;i++){this.confetti.push({x:x||window.innerWidth/2,y:y||window.innerHeight/3,vx:(Math.random()-0.5)*12,vy:-Math.random()*10-3,w:Math.random()*8+4,h:Math.random()*6+2,rotation:Math.random()*360,rotSpeed:(Math.random()-0.5)*10,color:colors[Math.floor(Math.random()*colors.length)],life:Math.random()*60+60})}},
        showScorePopup:function(pts,isCorrect,label){var el=document.createElement('div');el.className='score-popup '+(isCorrect?'positive':'negative');el.textContent=isCorrect?'+'+pts+(label?' '+label:''):'✗';document.body.appendChild(el);setTimeout(function(){el.remove()},1200)}
    };

    App.Modal = {
        open:function(title,bodyHTML,footerHTML){document.getElementById('modal-title').textContent=title;document.getElementById('modal-body').innerHTML=bodyHTML;document.getElementById('modal-footer').innerHTML=footerHTML||'';document.getElementById('modal-overlay').classList.add('active')},
        close:function(){document.getElementById('modal-overlay').classList.remove('active')},
        closeOnOverlay:function(e){if(e.target===document.getElementById('modal-overlay'))this.close()}
    };

    App.Toast = {
        container:null,
        init:function(){this.container=document.createElement('div');this.container.className='toast-container';document.body.appendChild(this.container)},
        show:function(msg,type){type=type||'info';var el=document.createElement('div');el.className='toast '+type;el.textContent=msg;this.container.appendChild(el);setTimeout(function(){el.remove()},3000)}
    };

    App.Students = {
        _sortBy:'points',
        _sortDir:'desc',
        _filterGroup:'',
        render:function(){
            var students=App.Storage.getStudents();
            var wrap=document.getElementById('student-table-wrap');
            var empty=document.getElementById('students-empty');
            if(students.length===0){wrap.innerHTML='';empty.classList.add('show');return}
            empty.classList.remove('show');
            var statsMap=getAllStudentStats();
            var groups=App.Storage.getGroups();
            var filterHTML='<div class="student-filters">';
            filterHTML+='<select id="sf-group" onchange="App.Students._filterGroup=this.value;App.Students.render()"><option value="">全部小组</option>';
            groups.forEach(function(g){filterHTML+='<option value="'+g+'"'+(this._filterGroup===g?' selected':'')+'>'+g+'</option>'}.bind(this));
            filterHTML+='</select>';
            filterHTML+='<select id="sf-sort" onchange="App.Students._sortBy=this.value;App.Students.render()">';
            filterHTML+='<option value="points"'+(this._sortBy==='points'?' selected':'')+'>按积分</option>';
            filterHTML+='<option value="accuracy"'+(this._sortBy==='accuracy'?' selected':'')+'>按正确率</option>';
            filterHTML+='<option value="name"'+(this._sortBy==='name'?' selected':'')+'>按姓名</option>';
            filterHTML+='<option value="sessions"'+(this._sortBy==='sessions'?' selected':'')+'>按场次</option>';
            filterHTML+='</select>';
            filterHTML+='<button class="btn-sm" onclick="App.Students._sortDir=App.Students._sortDir===\'desc\'?\'asc\':\'desc\';App.Students.render()" title="切换排序方向">'+(this._sortDir==='desc'?'↓ 降序':'↑ 升序')+'</button>';
            filterHTML+='</div>';
            var filtered=students;
            if(this._filterGroup){filtered=filtered.filter(function(s){return s.group===this._filterGroup}.bind(this))}
            filtered=filtered.map(function(s){
                var st=statsMap[s.id]||{totalPoints:0,accuracy:0,sessions:0,totalCorrect:0,totalCount:0};
                return{id:s.id,name:s.name,avatar:s.avatar,gender:s.gender,group:s.group,totalPoints:st.totalPoints,accuracy:st.accuracy,sessions:st.sessions,totalCorrect:st.totalCorrect,totalCount:st.totalCount};
            });
            var self=this;
            filtered.sort(function(a,b){
                var dir=self._sortDir==='desc'?-1:1;
                if(self._sortBy==='points')return(a.totalPoints-b.totalPoints)*dir;
                if(self._sortBy==='accuracy')return(a.accuracy-b.accuracy)*dir;
                if(self._sortBy==='sessions')return(a.sessions-b.sessions)*dir;
                return a.name.localeCompare(b.name,'zh-CN')*dir;
            });
            var html=filterHTML;
            var avMap=buildAvatarCharMap(filtered);
            html+='<table class="student-table readonly"><thead><tr>';
            html+='<th>头像</th><th>姓名</th><th>积分</th><th>等级</th><th>正确率</th><th>正确/总题</th><th>性别</th><th>小组</th><th>场次</th>';
            html+='</tr></thead><tbody>';
            filtered.forEach(function(s){
                var lv=getLevel(s.totalPoints);
                html+='<tr data-id="'+s.id+'">';
                html+='<td><div class="st-avatar-cell">'+(s.avatar?'<img src="'+s.avatar+'">':(avMap[s.id]||s.name.charAt(0)))+'</div></td>';
                html+='<td class="st-name-readonly">'+s.name+'</td>';
                html+='<td class="st-points-readonly" onclick="App.Students.showPointsDetail(\''+s.id+'\')" title="点击查看积分详情">⭐ '+s.totalPoints+'</td>';
                html+='<td><span class="st-level-badge">'+lv.name+'</span></td>';
                html+='<td>'+(s.totalCount>0?s.accuracy+'%':'-')+'</td>';
                html+='<td>'+(s.totalCount>0?s.totalCorrect+'/'+s.totalCount:'-')+'</td>';
                html+='<td>'+(s.gender||'-')+'</td>';
                html+='<td>'+(s.group||'-')+'</td>';
                html+='<td>'+s.sessions+'</td>';
                html+='</tr>';
            });
            html+='</tbody></table>';
            wrap.innerHTML=html;
        },
        showPointsDetail:function(id){
            var students=App.Storage.getStudents();
            var student=students.find(function(s){return s.id===id});
            if(!student)return;
            var st=getStudentStats(id);
            var lv=getLevel(st.totalPoints);
            var history=App.Records.getStudentHistory(id);
            var body='<div class="student-history-modal">';
            body+='<div style="text-align:center;margin-bottom:20px">';
            body+='<div class="lb-avatar" style="width:64px;height:64px;font-size:28px;margin:0 auto 10px">'+(student.avatar?'<img src="'+student.avatar+'">':(buildAvatarCharMap([student])[student.id]||student.name.charAt(0)))+'</div>';
            body+='<div style="font-size:22px;font-weight:800">'+student.name+'</div>';
            body+='<div style="color:var(--gold);font-weight:600">'+lv.name+' - '+lv.comment+'</div>';
            body+='<div style="font-size:28px;font-weight:900;color:var(--accent-2);margin-top:8px">⭐ '+st.totalPoints+' 分</div>';
            body+='<div style="font-size:14px;color:var(--text-muted);margin-top:4px">正确率 '+st.accuracy+'% · 共参加 '+st.sessions+' 场挑战</div>';
            body+='</div>';
            if(history.length===0){
                body+='<div style="text-align:center;color:var(--text-muted);padding:20px">暂无挑战记录</div>';
            }else{
                history.forEach(function(h){
                    var modeLabel=h.mode==='draw'?'🎲 多人挑战':h.mode==='assign'?'👤 单人挑战':h.mode==='pk'?'⚔️ PK':h.mode==='farm'?'🌾 打野':h.mode==='challenge'?'🎯 挑战':'🎮 未知';
                    var dateStr=new Date(h.date).toLocaleString('zh-CN');
                    var bankStr=h.bankNames.join('、')||'未知题库';
                    body+='<div class="sh-session">';
                    if(h.notDrawn){
                        body+='<div class="sh-session-header"><span class="sh-session-time">'+modeLabel+' · '+dateStr+'</span><span class="sh-session-score" style="color:var(--text-muted)">未抽中</span></div>';
                        body+='<div class="sh-session-detail">📚 '+bankStr+'</div>';
                        body+='<div class="sh-session-detail" style="color:var(--text-muted)">全员参与，本场未被抽中答题</div>';
                    }else{
                        var pct=h.totalCount>0?Math.round(h.correctCount/h.totalCount*100):0;
                        body+='<div class="sh-session-header"><span class="sh-session-time">'+modeLabel+' · '+dateStr+'</span><span class="sh-session-score">+'+h.pointsEarned+' 分</span></div>';
                        body+='<div class="sh-session-detail">📚 '+bankStr+'</div>';
                        body+='<div class="sh-session-detail">答对 '+h.correctCount+'/'+h.totalCount+' · 正确率 '+pct+'%</div>';
                    }
                    body+='</div>';
                });
            }
            body+='</div>';
            App.Modal.open('📊 '+student.name+' 的积分详情',body,'');
        }
    };

    App.Questions = {
        render:function(){var banks=App.Storage.getBanks();var grid=document.getElementById('bank-grid');var empty=document.getElementById('banks-empty');var fileIndex=JSON.parse(localStorage.getItem('exam_file_index')||'[]');var localBankIds=new Set(banks.map(function(b){return b.id||b.name}));var localBankNames=new Set(banks.map(function(b){return b.name}));var cloudOnlyBanks=fileIndex.filter(function(f){return f.cloudOnly&&f.id&&f.id.startsWith('QB_')&&!localBankIds.has(f.id)&&!localBankNames.has(f.name)&&f.name});if(banks.length===0&&cloudOnlyBanks.length===0){grid.innerHTML='';empty.classList.add('show');return}empty.classList.remove('show');var html='';banks.forEach(function(b){var hasContent=b.questions&&b.questions.length>0;var countText=hasContent?(b.questions.length+'道题'):'空题库';html+='<div class="bank-card" style="animation:slide-up 0.3s ease both"><div class="bc-header"><div><div class="bc-name">'+b.name+'</div><div class="bc-count">('+countText+')</div></div></div><div class="bc-desc">'+(b.description||'暂无描述')+'</div><div class="bc-actions"><button onclick="App.Questions.openBankManager(\''+b.id+'\')">📋 编辑预览</button><button onclick="App.Questions.showAddQuestionDialog(\''+b.id+'\')">➕ 添加题目</button><button onclick="App.Questions.showImportQuestionsDialog(\''+b.id+'\')">📥 导入题目</button><button class="btn-del" onclick="App.Questions.removeBank(\''+b.id+'\')">🗑️ 删除</button></div></div>'});cloudOnlyBanks.forEach(function(f){html+='<div class="bank-card" style="animation:slide-up 0.3s ease both"><div class="bc-header"><div><div class="bc-name">'+f.name+'</div><div class="bc-count">(空题库)</div></div></div><div class="bc-desc">'+(f.contentLength?f.contentLength+'字':'暂无描述')+'</div><div class="bc-actions"><button onclick="App.Questions.openBankManager(\''+f.id+'\')">📋 编辑预览</button><button class="btn-del" onclick="App.Questions.removeBank(\''+f.id+'\')">🗑️ 删除</button></div></div>'});grid.innerHTML=html},
        renderBankSelect:function(){var banks=App.Storage.getBanks();var info=document.getElementById('exam-bank-info');if(!info)return;var fileIndex=JSON.parse(localStorage.getItem('exam_file_index')||'[]');var localBankIds=new Set(banks.map(function(b){return b.id||b.name}));var localBankNames=new Set(banks.map(function(b){return b.name}));var cloudOnlyBanks=fileIndex.filter(function(f){return f.cloudOnly&&f.id&&f.id.startsWith('QB_')&&!localBankIds.has(f.id)&&!localBankNames.has(f.name)&&f.name});if(banks.length===0&&cloudOnlyBanks.length===0){info.textContent='暂无题库，请先创建';return}var lastIds=App.Storage.getSettings()._lastBankIds||[];var matched=banks.filter(function(b){return lastIds.indexOf(b.id)>=0});var cloudMatched=cloudOnlyBanks.filter(function(f){return lastIds.indexOf(f.id)>=0});if(matched.length>0||cloudMatched.length>0){var names=[];var totalQ=0;matched.forEach(function(b){names.push(b.name);totalQ+=b.questions.length});cloudMatched.forEach(function(f){names.push(f.name)});info.textContent=names.join('、')+'（'+totalQ+' 题）'}else{info.textContent='点击选择题库'}},
        showBankSelectModal:function(){var banks=App.Storage.getBanks();var fileIndex=JSON.parse(localStorage.getItem('exam_file_index')||'[]');var localBankIds=new Set(banks.map(function(b){return b.id||b.name}));var localBankNames=new Set(banks.map(function(b){return b.name}));var cloudOnlyBanks=fileIndex.filter(function(f){return f.cloudOnly&&f.id&&f.id.startsWith('QB_')&&!localBankIds.has(f.id)&&!localBankNames.has(f.name)&&f.name});if(banks.length===0&&cloudOnlyBanks.length===0){App.Toast.show('暂无题库，请先在题库中创建','warning');return}var lastIds=App.Storage.getSettings()._lastBankIds||[];var isPractice=App.Exam.currentMode==='practice';var body='<div class="bank-modal-grid">';banks.forEach(function(b){var sel=lastIds.indexOf(b.id)>=0?' selected':'';body+='<div class="bank-modal-item'+sel+'" data-bank-id="'+b.id+'" onclick="App.Questions.toggleModalBank(this,'+(isPractice?'true':'false')+')">';body+='<span class="bank-modal-check">'+(sel?'✓':'')+'</span>';body+='<span class="bank-modal-name">'+b.name+'</span>';body+='<span class="bank-modal-count">'+b.questions.length+' 题</span>';body+='</div>'});cloudOnlyBanks.forEach(function(f){var sel=lastIds.indexOf(f.id)>=0?' selected':'';body+='<div class="bank-modal-item'+sel+'" data-bank-id="'+f.id+'" onclick="App.Questions.toggleModalBank(this,'+(isPractice?'true':'false')+')">';body+='<span class="bank-modal-check">'+(sel?'✓':'')+'</span>';body+='<span class="bank-modal-name">'+f.name+'</span>';body+='<span class="bank-modal-count">0 题</span>';body+='</div>'});body+='</div>';var footer='';if(!isPractice){footer+='<button class="btn-secondary" onclick="App.Questions.selectAllModalBanks()">全选/取消</button>'}footer+='<button class="btn-secondary" onclick="App.Modal.close()">取消</button><button class="btn-primary" onclick="App.Questions.confirmBankSelect()">确定</button>';App.Modal.open(isPractice?'📚 选择题库（仅限1个）':'📚 选择题库',body,footer)},
        toggleModalBank:function(el,single){if(single){document.querySelectorAll('.bank-modal-item.selected').forEach(function(item){if(item!==el){item.classList.remove('selected');item.querySelector('.bank-modal-check').textContent=''}})}el.classList.toggle('selected');el.querySelector('.bank-modal-check').textContent=el.classList.contains('selected')?'✓':'';App.Effects.playClick()},
        selectAllModalBanks:function(){var items=document.querySelectorAll('.bank-modal-item');var allSel=true;items.forEach(function(el){if(!el.classList.contains('selected'))allSel=false});items.forEach(function(el){if(allSel){el.classList.remove('selected');el.querySelector('.bank-modal-check').textContent=''}else{if(!el.classList.contains('selected')){el.classList.add('selected');el.querySelector('.bank-modal-check').textContent='✓'}}});App.Effects.playClick()},
        confirmBankSelect:function(){var ids=[];document.querySelectorAll('.bank-modal-item.selected').forEach(function(el){ids.push(el.dataset.bankId)});if(ids.length===0){App.Toast.show('请至少选择一个题库','warning');return}if(App.Exam.currentMode==='practice'&&ids.length>1){App.Toast.show('练习模式只能选择1个题库','warning');return}var settings=App.Storage.getSettings();settings._lastBankIds=ids;App.Storage.setSettings(settings);App.Modal.close();this.renderBankSelect();App.Effects.playClick()},
        getSelectedBankIds:function(){var lastIds=App.Storage.getSettings()._lastBankIds||[];return lastIds},
        toggleBankSelect:function(el){el.classList.toggle('selected');el.querySelector('.check-mark').textContent=el.classList.contains('selected')?'✓':'';App.Effects.playClick()},
        showAddBankDialog:function(){var body='<div class="form-group"><label>题库名称</label><input type="text" id="inp-bank-name" placeholder="请输入题库名称"></div><div class="form-group"><label>题库描述</label><input type="text" id="inp-bank-desc" placeholder="简要描述（可选）"></div>';var footer='<button class="btn-secondary" onclick="App.Modal.close()">取消</button><button class="btn-primary" onclick="App.Questions.addBank()">创建</button>';App.Modal.open('新建题库',body,footer)},
        addBank:function(){var name=document.getElementById('inp-bank-name').value.trim();if(!name){App.Toast.show('请输入题库名称','warning');return}var desc=document.getElementById('inp-bank-desc').value.trim();var banks=App.Storage.getBanks();banks.push({id:genBankId(),name:name,description:desc,questions:[],createdAt:Date.now(),_newFile:true});App.Storage.setBanks(banks);App.Modal.close();this.render();App.Toast.show('题库 '+name+' 创建成功','success')},
        showEditBankDialog:function(id){var banks=App.Storage.getBanks();var b=banks.find(function(x){return x.id===id});if(!b)return;var body='<div class="form-group"><label>题库名称</label><input type="text" id="inp-bank-name" value="'+b.name+'"></div><div class="form-group"><label>题库描述</label><input type="text" id="inp-bank-desc" value="'+(b.description||'')+'"></div>';var footer='<button class="btn-secondary" onclick="App.Modal.close()">取消</button><button class="btn-primary" onclick="App.Questions.updateBank(\''+id+'\')">保存</button>';App.Modal.open('编辑题库',body,footer)},
        updateBank:function(id){var name=document.getElementById('inp-bank-name').value.trim();if(!name){App.Toast.show('请输入题库名称','warning');return}var desc=document.getElementById('inp-bank-desc').value.trim();var banks=App.Storage.getBanks();var b=banks.find(function(x){return x.id===id});if(!b)return;b.name=name;b.description=desc;App.Storage.setBanks(banks);App.Modal.close();this.render();App.Toast.show('题库信息已更新','success')},
        removeBank:function(id){if(!confirm('确定要删除该题库及其所有题目吗？'))return;var banks=App.Storage.getBanks();var deleted=banks.find(function(x){return x.id===id});var remaining=banks.filter(function(x){return x.id!==id});App.Storage.setBanks(remaining);if(deleted){App.Sync.deleteBank(deleted.id||deleted.name)}else{var prefix='exam';var fileIndex=JSON.parse(localStorage.getItem(prefix+'_file_index')||'[]');fileIndex=fileIndex.filter(function(f){return f.id!==id});try{localStorage.setItem(prefix+'_file_index',JSON.stringify(fileIndex))}catch(e){}}this.render();App.Toast.show('题库已删除','info')},
        downloadCloudBank:async function(id,name){
            App.Toast.show('正在从云端下载题库...','info');
            if(App.Sync&&App.Sync.ready){
                App.Sync.postToFileManager({type:'downloadCloudFile',fileId:id});
                var waitStart=Date.now();
                while(Date.now()-waitStart<15000){
                    await new Promise(function(r){setTimeout(r,500)});
                    var freshBanks=App.Storage.getBanks();
                    var freshBank=freshBanks.find(function(x){return x.id===id});
                    if(freshBank&&freshBank.questions&&freshBank.questions.length>0){
                        App.Questions.render();
                        App.Toast.show('题库「'+name+'」下载完成','success');
                        return;
                    }
                }
                App.Toast.show('题库下载超时，请检查网络','warning');
            }else{
                App.Toast.show('同步功能未就绪','warning');
            }
        },
        removeCloudBankIndex:function(id){
            if(!confirm('确定要移除该云端题库索引吗？（云端数据不会删除）'))return;
            var prefix='exam';
            var fileIndex=JSON.parse(localStorage.getItem(prefix+'_file_index')||'[]');
            fileIndex=fileIndex.filter(function(f){return f.id!==id});
            try{localStorage.setItem(prefix+'_file_index',JSON.stringify(fileIndex))}catch(e){}
            this.render();
            App.Toast.show('已移除云端题库索引','info');
        },
        openBankManager:async function(id){
            var banks=App.Storage.getBanks();var b=banks.find(function(x){return x.id===id});if(!b)return;
            // 题库内容为空（仅有索引），按需从云端下载
            if((!b.questions||b.questions.length===0)&&App.Sync&&App.Sync.ready){
                App.Toast.show('正在下载题库内容...','info');
                App.Sync.postToFileManager({type:'downloadCloudFile',fileId:b.id||b.name});
                var waitStart=Date.now();
                while(Date.now()-waitStart<10000){
                    await new Promise(function(r){setTimeout(r,500)});
                    var freshBanks=App.Storage.getBanks();
                    var freshBank=freshBanks.find(function(x){return x.id===id});
                    if(freshBank&&freshBank.questions&&freshBank.questions.length>0){b=freshBank;break}
                }
                if(!b.questions||b.questions.length===0){App.Toast.show('题库下载失败，请检查网络','warning');return}
            }
            var body='<div class="form-group"><label>题库名称</label><input type="text" id="inp-bank-name" value="'+b.name.replace(/"/g,'&quot;')+'"></div><div class="form-group"><label>题库描述</label><input type="text" id="inp-bank-desc" value="'+(b.description||'').replace(/"/g,'&quot;')+'"></div><hr style="border-color:rgba(108,92,231,0.2);margin:12px 0"><div class="question-preview-list">';b.questions.forEach(function(q,i){body+='<div class="qp-item"><div class="qp-text">'+(i+1)+'. '+q.text+'</div><div class="qp-options">';['A','B','C','D'].forEach(function(l){if(q.options[l])body+='<span style="margin-right:12px">'+l+'. '+q.options[l]+'</span>'});body+='</div><div class="qp-answer">正确答案：'+q.answer+' | 分值：'+q.points+'分</div><div class="qp-actions"><button class="btn-sm" onclick="App.Questions.editQuestion(\''+id+'\',\''+q.id+'\')">✏️ 编辑</button><button class="btn-sm btn-del" onclick="App.Questions.deleteQuestion(\''+id+'\',\''+q.id+'\')">🗑️ 删除</button></div></div>'});body+='</div>';var footer='<button class="btn-secondary" onclick="App.Modal.close()">关闭</button><button class="btn-primary" onclick="App.Questions.updateBankFromManager(\''+id+'\')">💾 保存题库信息</button>';App.Modal.open('📋 '+b.name+' ('+b.questions.length+'道题)',body,footer)},
        updateBankFromManager:function(id){var name=document.getElementById('inp-bank-name').value.trim();if(!name){App.Toast.show('请输入题库名称','warning');return}var desc=document.getElementById('inp-bank-desc').value.trim();var banks=App.Storage.getBanks();var b=banks.find(function(x){return x.id===id});if(!b)return;b.name=name;b.description=desc;App.Storage.setBanks(banks);App.Modal.close();this.render();App.Toast.show('题库信息已更新','success')},
        editQuestion:function(bankId,qId){var banks=App.Storage.getBanks();var bank=banks.find(function(x){return x.id===bankId});if(!bank)return;var q=bank.questions.find(function(x){return x.id===qId});if(!q)return;var body='<div class="form-group"><label>题目内容</label><textarea id="inp-eq-text" rows="3">'+q.text+'</textarea></div><div class="form-group"><label>选项A</label><input type="text" id="inp-eq-a" value="'+(q.options.A||'').replace(/"/g,'&quot;')+'"></div><div class="form-group"><label>选项B</label><input type="text" id="inp-eq-b" value="'+(q.options.B||'').replace(/"/g,'&quot;')+'"></div><div class="form-group"><label>选项C</label><input type="text" id="inp-eq-c" value="'+(q.options.C||'').replace(/"/g,'&quot;')+'"></div><div class="form-group"><label>选项D</label><input type="text" id="inp-eq-d" value="'+(q.options.D||'').replace(/"/g,'&quot;')+'"></div><div class="form-group"><label>正确答案</label><select id="inp-eq-answer"><option value="A"'+(q.answer==='A'?' selected':'')+'>A</option><option value="B"'+(q.answer==='B'?' selected':'')+'>B</option><option value="C"'+(q.answer==='C'?' selected':'')+'>C</option><option value="D"'+(q.answer==='D'?' selected':'')+'>D</option></select></div><div class="form-group"><label>分值</label><input type="number" id="inp-eq-points" value="'+q.points+'" min="1" max="100" style="width:80px"></div>';var footer='<button class="btn-secondary" onclick="App.Questions.openBankManager(\''+bankId+'\')">取消</button><button class="btn-primary" onclick="App.Questions.saveEditQuestion(\''+bankId+'\',\''+qId+'\')">保存</button>';App.Modal.open('✏️ 编辑题目',body,footer)},
        saveEditQuestion:function(bankId,qId){var text=document.getElementById('inp-eq-text').value.trim();if(!text){App.Toast.show('请输入题目内容','warning');return}var a=document.getElementById('inp-eq-a').value.trim();var b=document.getElementById('inp-eq-b').value.trim();if(!a||!b){App.Toast.show('至少填写选项A和B','warning');return}var banks=App.Storage.getBanks();var bank=banks.find(function(x){return x.id===bankId});if(!bank)return;var q=bank.questions.find(function(x){return x.id===qId});if(!q)return;q.text=text;q.options={A:a,B:b,C:document.getElementById('inp-eq-c').value.trim(),D:document.getElementById('inp-eq-d').value.trim()};q.answer=document.getElementById('inp-eq-answer').value;q.points=parseInt(document.getElementById('inp-eq-points').value)||10;App.Storage.setBanks(banks);App.Modal.close();this.openBankManager(bankId);App.Toast.show('题目已更新','success')},
        deleteQuestion:function(bankId,qId){if(!confirm('确定要删除这道题目吗？'))return;var banks=App.Storage.getBanks();var bank=banks.find(function(x){return x.id===bankId});if(!bank)return;bank.questions=bank.questions.filter(function(q){return q.id!==qId});App.Storage.setBanks(banks);App.Modal.close();this.openBankManager(bankId);this.render();App.Toast.show('题目已删除','info')},
        showAddQuestionDialog:function(bankId){var body='<div class="form-group"><label>题目内容</label><textarea id="inp-q-text" placeholder="请输入题目内容" rows="3"></textarea></div><div class="form-group"><label>选项A</label><input type="text" id="inp-q-a" placeholder="选项A内容"></div><div class="form-group"><label>选项B</label><input type="text" id="inp-q-b" placeholder="选项B内容"></div><div class="form-group"><label>选项C</label><input type="text" id="inp-q-c" placeholder="选项C内容"></div><div class="form-group"><label>选项D</label><input type="text" id="inp-q-d" placeholder="选项D内容"></div><div class="form-group"><label>正确答案</label><select id="inp-q-answer"><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option></select></div><div class="form-group"><label>分值</label><input type="number" id="inp-q-points" value="10" min="1" max="100" style="width:80px"></div>';var footer='<button class="btn-secondary" onclick="App.Modal.close()">取消</button><button class="btn-primary" onclick="App.Questions.addQuestion(\''+bankId+'\')">添加</button>';App.Modal.open('添加题目',body,footer)},
        addQuestion:function(bankId){var text=document.getElementById('inp-q-text').value.trim();if(!text){App.Toast.show('请输入题目内容','warning');return}var a=document.getElementById('inp-q-a').value.trim();var b=document.getElementById('inp-q-b').value.trim();var c=document.getElementById('inp-q-c').value.trim();var d=document.getElementById('inp-q-d').value.trim();if(!a||!b){App.Toast.show('至少填写选项A和B','warning');return}var answer=document.getElementById('inp-q-answer').value;var points=parseInt(document.getElementById('inp-q-points').value)||10;var banks=App.Storage.getBanks();var bank=banks.find(function(x){return x.id===bankId});if(!bank)return;bank.questions.push({id:genId(),text:text,options:{A:a,B:b,C:c||'',D:d||''},answer:answer,points:points});App.Storage.setBanks(banks);App.Modal.close();this.render();App.Toast.show('题目添加成功','success')},
        showImportQuestionsDialog:function(bankId){var body='<div class="import-format-hint">导入格式说明：第一行可为题库名（不含|则视为题库名），后续每行一道题<br>格式：<code>题库名称</code>（可选）<br>题目格式：<code>题目|选项A|选项B|选项C|选项D|正确答案|分值</code><br>示例：<br><code>数学基础</code><br><code>1+1=?|1|2|3|4|B|10</code><br><code>中国的首都是?|上海|北京|广州|深圳|B|10</code></div><div class="form-group"><label>粘贴题目数据</label><textarea id="inp-import-questions" placeholder="第一行：题库名称（可选）&#10;后续每行一道题" rows="8"></textarea></div>';var footer='<button class="btn-secondary" onclick="App.Modal.close()">取消</button><button class="btn-primary" onclick="App.Questions.doImportQuestions(\''+bankId+'\')">导入</button>';App.Modal.open('📥 导入题目',body,footer)},
        doImportQuestions:function(bankId){var text=document.getElementById('inp-import-questions').value.trim();if(!text){App.Toast.show('请输入题目数据','warning');return}var banks=App.Storage.getBanks();var bank=banks.find(function(x){return x.id===bankId});if(!bank)return;var lines=text.split('\n'),count=0,startIdx=0;if(lines.length>0&&lines[0].trim().indexOf('|')===-1&&lines[0].trim()){bank.name=lines[0].trim();startIdx=1}for(var i=startIdx;i<lines.length;i++){var line=lines[i].trim();if(!line)continue;var p=line.split('|');if(p.length>=6){bank.questions.push({id:genId(),text:p[0].trim(),options:{A:p[1].trim(),B:p[2].trim(),C:p[3].trim(),D:p[4].trim()},answer:p[5].trim().toUpperCase(),points:parseInt(p[6])||10});count++}}App.Storage.setBanks(banks);App.Modal.close();this.render();App.Toast.show('成功导入 '+count+' 道题目'+(startIdx===1?'，题库已重命名为「'+bank.name+'」':''),'success')},
        copyTemplateForAI:function(){
            var tpl='请按以下格式生成选择题，每行一道题，用|分隔字段：\n\n题库名称\n题目|选项A|选项B|选项C|选项D|正确答案|分值\n\n示例：\n\n数学基础\n1+1=?|1|2|3|4|B|10\n中国的首都是?|上海|北京|广州|深圳|B|10\n\n请生成10道关于【在此填写主题】的选择题，每题4个选项，分值10分。直接输出题目数据，不要其他解释。';
            if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(tpl).then(function(){App.Toast.show('模板已复制，粘贴给AI即可','success')}).catch(function(){App.Questions._fallbackCopy(tpl)})}
            else{this._fallbackCopy(tpl)}
        },
        _fallbackCopy:function(text){var ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.left='-9999px';document.body.appendChild(ta);ta.select();try{document.execCommand('copy');App.Toast.show('模板已复制，粘贴给AI即可','success')}catch(e){App.Toast.show('复制失败，请手动复制','warning')}document.body.removeChild(ta)},
        showAIDialog:function(){var body='<div class="form-group"><label>题目主题/知识点</label><textarea id="inp-ai-topic" placeholder="请描述要生成的题目主题，越详细越好" rows="4" maxlength="2000"></textarea><div style="text-align:right;font-size:11px;color:#666;margin-top:2px"><span id="ai-topic-count">0</span>/2000</div></div><div class="form-group"><label>题目数量</label><input type="number" id="inp-ai-count" value="5" min="1" max="30" style="width:80px"> <span class="form-hint">1~30题</span></div><div class="form-group"><label>题库名称 <span style="color:#888;font-weight:normal">（留空则AI自动命名）</span></label><input type="text" id="inp-ai-bank-name" placeholder="AI将根据主题自动生成名称"></div><div id="ai-status" class="ai-status" style="display:none"></div>';var footer='<button class="btn-secondary" onclick="App.Modal.close()">取消</button><button class="btn-primary" id="btn-ai-gen" onclick="App.Questions.generateAIQuestions()">🤖 生成</button>';App.Modal.open('🤖 AI生成题目',body,footer);var ta=document.getElementById('inp-ai-topic');if(ta){ta.addEventListener('input',function(){var c=document.getElementById('ai-topic-count');if(c)c.textContent=ta.value.length})}},
        generateAIQuestions:function(){var s=App.Storage.getSettings();if(!s.aiApiKey||!s.aiApiUrl){App.Toast.show('请先在设置中配置AI API','warning');return}var topic=document.getElementById('inp-ai-topic').value.trim();if(!topic){App.Toast.show('请输入题目主题','warning');return}var count=parseInt(document.getElementById('inp-ai-count').value)||5;if(count<1)count=1;if(count>30)count=30;var userBankName=document.getElementById('inp-ai-bank-name').value.trim();var statusEl=document.getElementById('ai-status');statusEl.style.display='block';statusEl.className='ai-status processing';statusEl.textContent='⏳ 正在生成题目，请稍候...';document.getElementById('btn-ai-gen').disabled=true;var prompt='你是一个专业的考试出题专家。请根据以下要求生成选择题：\n\n主题：'+topic+'\n数量：'+count+'道\n\n要求：\n1. 每道题必须有4个选项(A/B/C/D)，且只有一个正确答案\n2. 题目内容要准确、专业，选项要有迷惑性\n3. 分值默认10分，可根据难度调整(5/10/15/20)\n4. 如果用户没有指定题库名称，请根据主题生成一个简短贴切的题库名称\n\n请严格按照以下JSON格式返回，不要添加任何其他文字：\n{"bankName":"题库名称","questions":[{"text":"题目内容","options":{"A":"选项A","B":"选项B","C":"选项C","D":"选项D"},"answer":"B","points":10}]}\n\n注意：只返回这个JSON对象，不要返回任何解释或额外内容。';try{fetch(s.aiApiUrl,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+s.aiApiKey},body:JSON.stringify({model:s.aiModel||'glm-4.7-flash',messages:[{role:'user',content:prompt}],temperature:0.7})}).then(function(res){if(!res.ok)throw new Error('HTTP '+res.status);return res.json()}).then(function(data){var content='';if(data.choices&&data.choices[0]&&data.choices[0].message){content=data.choices[0].message.content||''}else if(data.output){content=data.output.text||data.output||''}else if(typeof data==='string'){content=data}content=content.trim();if(content.startsWith('```')){content=content.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'')}var jsonMatch=content.match(/\{[\s\S]*\}/);if(!jsonMatch)throw new Error('AI返回内容无法解析为JSON');var result=JSON.parse(jsonMatch[0]);var questions=result.questions||result;var bankName=userBankName||result.bankName||'AI生成题库';if(!Array.isArray(questions))throw new Error('AI返回的题目格式不正确');var banks=App.Storage.getBanks();var newBank={id:genBankId(),name:bankName,description:'AI生成 - '+topic,questions:[],createdAt:Date.now(),_newFile:true};var validCount=0;questions.forEach(function(q){if(!q.text||!q.options||!q.answer)return;var opts={};if(typeof q.options==='object'){opts=q.options}else if(Array.isArray(q.options)){var keys=['A','B','C','D'];for(var oi=0;oi<Math.min(q.options.length,4);oi++){opts[keys[oi]]=String(q.options[oi])}}newBank.questions.push({id:genId(),text:q.text,options:opts,answer:String(q.answer).toUpperCase().charAt(0),points:parseInt(q.points)||10});validCount++});if(validCount===0)throw new Error('AI未生成有效题目');banks.push(newBank);App.Storage.setBanks(banks);App.Modal.close();App.Questions.render();App.Toast.show('成功生成 '+validCount+' 道题目 → '+bankName,'success')}).catch(function(err){statusEl.className='ai-status error';statusEl.textContent='❌ 生成失败：'+err.message;document.getElementById('btn-ai-gen').disabled=false})}catch(e){statusEl.className='ai-status error';statusEl.textContent='❌ 请求失败：'+e.message;document.getElementById('btn-ai-gen').disabled=false}},
        showImportBankDialog:function(){
            var body='<div class="import-format-hint">导入格式说明：第一行为题库名称，后续每行一道题<br>格式：<code>题库名称</code><br>题目格式：<code>题目|选项A|选项B|选项C|选项D|正确答案|分值</code><br>示例：<br><code>数学基础</code><br><code>1+1=?|1|2|3|4|B|10</code><br><code>中国的首都是?|上海|北京|广州|深圳|B|10</code></div>';
            body+='<div class="form-group"><label>粘贴题库数据</label><textarea id="inp-import-bank" placeholder="第一行：题库名称&#10;后续每行一道题" rows="8"></textarea></div>';
            var footer='<button class="btn-secondary" onclick="App.Modal.close()">取消</button><button class="btn-primary" onclick="App.Questions.doImportBank()">导入</button>';
            App.Modal.open('📥 导入题库',body,footer);
        },
        doImportBank:function(){
            var text=document.getElementById('inp-import-bank').value.trim();
            if(!text){App.Toast.show('请输入题库数据','warning');return}
            var lines=text.split('\n');
            var bankName=lines[0].trim()||'导入题库';
            var banks=App.Storage.getBanks();
            var newBank={id:genBankId(),name:bankName,description:'导入题库',questions:[],createdAt:Date.now(),_newFile:true};
            var count=0;
            for(var i=1;i<lines.length;i++){
                var line=lines[i].trim();
                if(!line)continue;
                var p=line.split('|');
                if(p.length>=6){
                    newBank.questions.push({id:genId(),text:p[0].trim(),options:{A:p[1].trim(),B:p[2].trim(),C:p[3].trim(),D:p[4].trim()},answer:p[5].trim().toUpperCase(),points:parseInt(p[6])||10});
                    count++;
                }
            }
            banks.push(newBank);
            App.Storage.setBanks(banks);
            App.Modal.close();this.render();
            App.Toast.show('成功导入题库「'+bankName+'」，共 '+count+' 道题目','success');
        },
        exportTemplate:function(){var template='题目|选项A|选项B|选项C|选项D|正确答案|分值\n1+1=?|1|2|3|4|B|10\n中国的首都是?|上海|北京|广州|深圳|B|10';var blob=new Blob([template],{type:'text/plain;charset=utf-8'});var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;a.download='题目导入模板.txt';a.click();URL.revokeObjectURL(url);App.Toast.show('模板已导出','success')},
        importTemplateFile:function(){var input=document.getElementById('inp-template-file');if(input){input.value='';input.click()}},
        handleTemplateFile:function(input){if(!input.files||!input.files[0])return;var file=input.files[0];var reader=new FileReader();reader.onload=function(e){var text=e.target.result;if(!text||!text.trim()){App.Toast.show('文件内容为空','warning');return}var lines=text.trim().split('\n');var bankName='导入题库';var startIdx=0;if(lines.length>0&&lines[0].trim().indexOf('|')===-1&&lines[0].trim()){bankName=lines[0].trim();startIdx=1}var banks=App.Storage.getBanks();var newBank={id:genBankId(),name:bankName,description:'从文件导入',questions:[],createdAt:Date.now(),_newFile:true};var count=0;for(var i=startIdx;i<lines.length;i++){var line=lines[i].trim();if(!line)continue;var p=line.split('|');if(p.length>=6){newBank.questions.push({id:genId(),text:p[0].trim(),options:{A:p[1].trim(),B:p[2].trim(),C:p[3].trim(),D:p[4].trim()},answer:p[5].trim().toUpperCase(),points:parseInt(p[6])||10});count++}}if(count===0){App.Toast.show('未识别到有效题目，请检查文件格式','warning');return}banks.push(newBank);App.Storage.setBanks(banks);App.Questions.render();App.Toast.show('成功导入 '+count+' 道题目 → '+bankName,'success')};reader.readAsText(file,'utf-8')}
    };

    App.Exam = {
        currentMode:'draw',currentExam:null,timerInterval:null,timeLeft:0,
        renderOptionsHTML:function(question){
            var settings=App.Storage.getSettings();
            var labels=['A','B','C','D'];
            var items=[];
            labels.forEach(function(l){if(question.options[l])items.push({label:l,text:question.options[l]})});
            if(settings.shuffleOptions){
                var shuffled=shuffle(items);
                var newOpts={};var newAnswer='';
                shuffled.forEach(function(item,i){
                    var newLabel=labels[i];
                    newOpts[newLabel]=item.text;
                    if(item.label===question.answer)newAnswer=newLabel;
                });
                question._shuffledOptions=newOpts;
                question._shuffledAnswer=newAnswer;
                items=shuffled.map(function(item,i){return{label:labels[i],text:item.text}});
            }else{
                delete question._shuffledOptions;delete question._shuffledAnswer;
            }
            var optsHTML='';
            items.forEach(function(item){optsHTML+='<button class="option-btn" data-option="'+item.label+'" onclick="App.Exam.selectOption(\''+item.label+'\')"><span class="option-label">'+item.label+'</span><span>'+item.text+'</span></button>'});
            return optsHTML;
        },
        getEffectiveAnswer:function(question){
            return question._shuffledAnswer||question.answer;
        },
        calcTimeout:function(questionText){
            var baseInput=document.getElementById('exam-base-timeout-inline');
            var charInput=document.getElementById('exam-char-timeout-inline');
            var base,charComp;
            if(baseInput&&document.getElementById('exam-setup')&&!document.getElementById('exam-setup').classList.contains('hidden')){
                base=parseFloat(baseInput.value)||0;
                charComp=parseFloat(charInput.value)||0;
            }else{
                var settings=App.Storage.getSettings();
                base=settings.baseTimeout!==undefined?settings.baseTimeout:30;
                charComp=settings.charTimeoutCompensation!==undefined?settings.charTimeoutCompensation:0.2;
            }
            if(base<=0&&charComp<=0)return 0;
            var charCount=(questionText||'').length;
            return Math.round(base+charCount*charComp);
        },
        checkResumableExam:function(){
            var progress=App.Storage.getExamProgress();
            if(!progress||!progress.questions||progress.questions.length===0)return false;
            if(progress.mode==='practice')return false;
            var exam={
                mode:progress.mode,
                participationType:progress.participationType,
                questions:progress.questions,
                timeLimit:progress.timeLimit,
                autoNext:progress.autoNext,
                students:progress.students,
                currentIndex:progress.currentIndex,
                results:progress.results||[],
                playerScores:progress.playerScores||{},
                totalEarned:progress.totalEarned||0,
                playerQueue:progress.playerQueue,
                queueIndex:progress.queueIndex,
                avgQuestions:progress.avgQuestions,
                groupNames:progress.groupNames||[],
                groupRotation:progress.groupRotation||'alternate',
                groupMap:progress.groupMap||null,
                groupScores:progress.groupScores||null,
                _pointsPerQ:progress._pointsPerQ||null,
                _isRetry:progress._isRetry||false,
                _smartProbMap:progress._smartProbMap||null
            };
            if(progress.currentStudentId){
                var cs=exam.students.find(function(s){return s.id===progress.currentStudentId});
                if(cs)exam.currentStudent=cs;
            }
            this.currentExam=exam;
            document.getElementById('exam-mode-select').classList.add('hidden');
            document.getElementById('exam-setup').classList.add('hidden');
            document.getElementById('exam-drawing').classList.add('hidden');
            document.getElementById('exam-playing').classList.remove('hidden');
            document.getElementById('exam-play-sidebar').classList.remove('hidden');
            var hc=document.querySelector('.home-container');if(hc)hc.classList.add('in-exam');
            var labels=window.ParticipationLabels||{};
            var label=(labels[exam.participationType]&&labels[exam.participationType][exam.mode])||exam.mode;
            var navMode=document.getElementById('nav-exam-mode');if(navMode){navMode.textContent=label;navMode.classList.remove('hidden')}
            var navEnd=document.getElementById('nav-exam-end');if(navEnd)navEnd.classList.remove('hidden');
            if(!document.fullscreenElement){
                document.documentElement.requestFullscreen().catch(function(){});
            }
            this.renderWarReport(false);
            this.showQuestion();
            App.Toast.show('已恢复上次比赛','success');
            return true;
        },
        enterMode:function(mode){
            this.currentMode=mode;
            var settings=App.Storage.getSettings();
            var lastPT=settings.lastParticipationType||'personal';
            this.participationType=lastPT;
            var isLottery=mode==='lottery';
            if(isLottery){this.participationType='personal';lastPT='personal'}
            document.getElementById('exam-mode-select').classList.add('hidden');
            document.getElementById('exam-setup').classList.remove('hidden');
            var titleEl=document.getElementById('setup-mode-title');
            var btnIcon=document.getElementById('btn-start-icon');
            var btnText=document.getElementById('btn-start-text');
            var groupArea=document.getElementById('exam-group-select-area');
            var studentArea=document.getElementById('exam-student-select-area');
            var rotationOpt=document.getElementById('opt-group-rotation');
            var ptabPersonal=document.getElementById('ptab-personal');
            var ptabGroup=document.getElementById('ptab-group');
            var isPractice=mode==='practice';
            var isSmart=mode==='smart';
            if(lastPT==='group'){
                if(groupArea)groupArea.style.display='';
                if(studentArea)studentArea.style.display='none';
                if(rotationOpt)rotationOpt.style.display='';
                if(ptabPersonal)ptabPersonal.classList.remove('active');
                if(ptabGroup){ptabGroup.classList.add('active');ptabGroup.style.display=(isPractice||isLottery)?'none':''}
            }else{
                if(groupArea)groupArea.style.display='none';
                if(studentArea)studentArea.style.display='';
                if(rotationOpt)rotationOpt.style.display='none';
                if(ptabPersonal)ptabPersonal.classList.add('active');
                if(ptabGroup){ptabGroup.classList.remove('active');ptabGroup.style.display=(isPractice||isLottery)?'none':''}
            }
            this._updateModeTitle();
            btnText.textContent='开始';
            this.renderRulesPanel(mode,lastPT);
            if(lastPT==='group')this.renderGroupSelect();
            else this.renderStudentSelect();
            App.Questions.renderBankSelect();
            var bankBar=document.getElementById('exam-bank-bar');
            if(bankBar)bankBar.style.display=isLottery?'none':'';
            var baseInput=document.getElementById('exam-base-timeout-inline');
            var charInput=document.getElementById('exam-char-timeout-inline');
            if(baseInput)baseInput.value=settings.baseTimeout!==undefined?settings.baseTimeout:30;
            if(charInput)charInput.value=settings.charTimeoutCompensation!==undefined?settings.charTimeoutCompensation:0.2;
            var playerOrderEl=document.getElementById('exam-player-order');
            var questionOrderEl=document.getElementById('exam-question-order');
            var avgQEl=document.getElementById('exam-avg-questions');
            var groupRotEl=document.getElementById('exam-group-rotation');
            if(playerOrderEl&&settings.lastPlayerOrder)playerOrderEl.value=settings.lastPlayerOrder;
            if(questionOrderEl&&settings.lastQuestionOrder)questionOrderEl.value=settings.lastQuestionOrder;
            if(avgQEl&&settings.lastAvgQuestions)avgQEl.value=settings.lastAvgQuestions;
            if(groupRotEl&&settings.lastGroupRotation)groupRotEl.value=settings.lastGroupRotation;
            var playerOrderGroup=playerOrderEl?playerOrderEl.closest('.option-group'):null;
            var questionOrderGroup=questionOrderEl?questionOrderEl.closest('.option-group'):null;
            var avgQGroup=avgQEl?avgQEl.closest('.option-group'):null;
            if(playerOrderGroup)playerOrderGroup.style.display=(isPractice||isSmart||isLottery)?'none':'';
            if(questionOrderGroup)questionOrderGroup.style.display=(isPractice||isLottery)?'none':'';
            if(avgQGroup)avgQGroup.style.display=(isPractice||isLottery)?'none':'';
            var timeoutGroup=document.getElementById('opt-group-timeout');
            if(timeoutGroup)timeoutGroup.style.display=isLottery?'none':'';
            var lotteryRandomGroup=document.getElementById('opt-group-lottery-random');
            if(lotteryRandomGroup)lotteryRandomGroup.style.display=isLottery?'':'none';
            if(isLottery&&lotteryRandomGroup){
                var savedLR=settings.lastLotteryRandom||'fairCycle';
                var lrSelect=document.getElementById('exam-lottery-random');
                if(lrSelect){for(var li=0;li<lrSelect.options.length;li++){if(lrSelect.options[li].value===savedLR){lrSelect.selectedIndex=li;break}}}
                if(playerOrderEl)playerOrderEl.value='random';
            }
            var smartGroup=document.getElementById('opt-group-smart');
            if(smartGroup)smartGroup.style.display=isSmart?'':'none';
            if(isSmart){
                if(playerOrderEl)playerOrderEl.value='smart';
                var intensityInput=document.getElementById('exam-smart-intensity');
                if(intensityInput)intensityInput.value=settings.smartIntensity||5;
                this._updateSmartPreview();
            }
            App.Effects.playClick();
        },
        switchParticipation:function(type){
            if(this.currentMode==='lottery'&&type==='group'){App.Toast.show('抽签模式仅支持个人','warning');return}
            this.participationType=type;
            var groupArea=document.getElementById('exam-group-select-area');
            var studentArea=document.getElementById('exam-student-select-area');
            var rotationOpt=document.getElementById('opt-group-rotation');
            document.getElementById('ptab-personal').classList.toggle('active',type==='personal');
            document.getElementById('ptab-group').classList.toggle('active',type==='group');
            if(type==='group'){
                if(groupArea)groupArea.style.display='';
                if(studentArea)studentArea.style.display='none';
                if(rotationOpt)rotationOpt.style.display='';
                this.renderGroupSelect();
            }else{
                if(groupArea)groupArea.style.display='none';
                if(studentArea)studentArea.style.display='';
                if(rotationOpt)rotationOpt.style.display='none';
            }
            this._updateModeTitle();
            this.renderRulesPanel(this.currentMode,type);
            App.Effects.playClick();
        },
        _updateModeTitle:function(){
            var mode=this.currentMode;
            var pType=this.participationType;
            var labels=window.ParticipationLabels||{};
            var label=(labels[pType]&&labels[pType][mode])||mode;
            var titleEl=document.getElementById('setup-mode-title');
            var btnIcon=document.getElementById('btn-start-icon');
            var studentTitleEl=document.getElementById('student-select-title');
            if(titleEl)titleEl.textContent=label;
            if(btnIcon){
                var icons={farm:'🌾',challenge:'🎯',pk:'⚔️',practice:'📝',smart:'🧠',lottery:'🎲'};
                btnIcon.textContent=icons[mode]||'🎮';
            }
            if(pType==='personal'){
                var titles={farm:'👥 参与人员',challenge:'👥 参与人员',pk:'⚔️ PK参赛选手（请选择2-8名）',practice:'👤 选择练习学生（仅限1人）',smart:'👥 参与人员（智能抽查）',lottery:'👥 参与人员（抽签池）'};
                if(studentTitleEl)studentTitleEl.textContent=titles[mode]||'👥 参与人员';
            }
        },
        renderRulesPanel:function(mode,pType){
            var panel=document.getElementById('setup-rules-panel');
            if(!panel||!window.ModeRules)return;
            var rule=ModeRules[mode];
            if(!rule){panel.innerHTML='';return}
            var html='<div class="rules-card">';
            html+='<h4 class="rules-title">'+rule.title+' 规则</h4>';
            html+='<ul class="rules-list">';
            rule.rules.forEach(function(r){html+='<li>'+r+'</li>'});
            if(pType==='group'&&rule.groupExtra){html+='<li class="rules-group-extra">🏆 '+rule.groupExtra+'</li>'}
            html+='</ul>';
            if(window.CommonRules&&mode!=='practice'&&mode!=='lottery'){
                html+='<h4 class="rules-title" style="margin-top:16px">通用规则</h4>';
                html+='<ul class="rules-list">';
                CommonRules.forEach(function(r){html+='<li>'+r+'</li>'});
                html+='</ul>';
            }
            html+='</div>';
            panel.innerHTML=html;
        },
        backToModes:function(){
            document.getElementById('exam-mode-select').classList.remove('hidden');
            document.getElementById('exam-setup').classList.add('hidden');
            document.getElementById('exam-drawing').classList.add('hidden');
            document.getElementById('exam-playing').classList.add('hidden');
            document.getElementById('exam-play-sidebar').classList.add('hidden');
            var hc=document.querySelector('.home-container');if(hc)hc.classList.remove('in-exam');
            var ptabGroup=document.getElementById('ptab-group');if(ptabGroup)ptabGroup.style.display='';
            var playerOrderGroup=document.getElementById('exam-player-order').closest('.option-group');
            var questionOrderGroup=document.getElementById('exam-question-order').closest('.option-group');
            var avgQGroup=document.getElementById('exam-avg-questions').closest('.option-group');
            if(playerOrderGroup)playerOrderGroup.style.display='';
            if(questionOrderGroup)questionOrderGroup.style.display='';
            if(avgQGroup)avgQGroup.style.display='';
            var timeoutGroup=document.getElementById('opt-group-timeout');
            if(timeoutGroup)timeoutGroup.style.display='';
            var bankBar=document.getElementById('exam-bank-bar');
            if(bankBar)bankBar.style.display='';
            var smartGroup=document.getElementById('opt-group-smart');
            if(smartGroup)smartGroup.style.display='none';
            var lotteryRandomGroup=document.getElementById('opt-group-lottery-random');
            if(lotteryRandomGroup)lotteryRandomGroup.style.display='none';
            App.Effects.playClick();
        },
        renderGroupSelect:function(){
            var groups=App.Storage.getGroups();
            var area=document.getElementById('exam-group-select-area');
            if(!area)return;
            if(groups.length===0){area.innerHTML='<h3 class="sub-title">👥 选择参赛小组</h3><p style="color:var(--text-muted);text-align:center;">暂无小组，请先在设置→学生中设置小组</p>';return}
            var html='<h3 class="sub-title">👥 选择参赛小组</h3><div class="group-select-list">';
            groups.forEach(function(g){
                html+='<div class="group-select-item" data-group-name="'+g+'" onclick="App.Exam.toggleGroupSelect(this)">';
                html+='<span class="group-name">🏆 '+g+'</span>';
                var students=App.Storage.getStudents().filter(function(s){return s.group===g});
                html+='<span class="group-count">'+students.length+' 人</span>';
                html+='<span class="check-mark"></span></div>';
            });
            html+='</div>';area.innerHTML=html;
        },
        toggleGroupSelect:function(el){el.classList.toggle('selected');el.querySelector('.check-mark').textContent=el.classList.contains('selected')?'✓':'';App.Effects.playClick()},
        getSelectedGroupNames:function(){var names=[];document.querySelectorAll('.group-select-item.selected').forEach(function(el){names.push(el.dataset.groupName)});return names},
        renderStudentSelect:function(){var students=App.Storage.getStudents();var list=document.getElementById('exam-student-list');if(students.length===0){list.innerHTML='<p style="color:var(--text-muted);text-align:center;">暂无学生，请先在设置→学生中添加</p>';return}var html='';students.forEach(function(s){html+='<div class="student-select-item" data-student-id="'+s.id+'" onclick="App.Exam.toggleStudentSelect(this)"><span>'+(s.avatar?'<img src="'+s.avatar+'" style="width:20px;height:20px;border-radius:50%;vertical-align:middle"> ':'')+' '+s.name+'</span><span class="check-mark"></span></div>'});list.innerHTML=html},
        toggleStudentSelect:function(el){var mode=this.currentMode;if(mode==='practice'){if(el.classList.contains('selected')){el.classList.remove('selected');el.querySelector('.check-mark').textContent=''}else{document.querySelectorAll('.student-select-item.selected').forEach(function(other){if(other!==el){other.classList.remove('selected');other.querySelector('.check-mark').textContent=''}});el.classList.add('selected');el.querySelector('.check-mark').textContent='✓'}}else if(mode==='pk'){if(el.classList.contains('selected')){el.classList.remove('selected');el.querySelector('.check-mark').textContent=''}else{var count=document.querySelectorAll('.student-select-item.selected').length;if(count>=8){App.Toast.show('PK最多选择8名选手','warning');return}el.classList.add('selected');el.querySelector('.check-mark').textContent='✓'}}else{el.classList.toggle('selected');el.querySelector('.check-mark').textContent=el.classList.contains('selected')?'✓':''}App.Effects.playClick()},
        getSelectedStudentIds:function(){var ids=[];document.querySelectorAll('.student-select-item.selected').forEach(function(el){ids.push(el.dataset.studentId)});return ids},
        selectAllStudents:function(){var mode=this.currentMode;var items=document.querySelectorAll('.student-select-item');var allSelected=true;items.forEach(function(el){if(!el.classList.contains('selected'))allSelected=false});if(allSelected){items.forEach(function(el){el.classList.remove('selected');el.querySelector('.check-mark').textContent=''})}else if(mode==='practice'){App.Toast.show('练习模式仅限选择1人','warning')}else if(mode==='pk'){var count=document.querySelectorAll('.student-select-item.selected').length;items.forEach(function(el){if(!el.classList.contains('selected')&&count<8){el.classList.add('selected');el.querySelector('.check-mark').textContent='✓';count++}})}else{items.forEach(function(el){if(!el.classList.contains('selected')){el.classList.add('selected');el.querySelector('.check-mark').textContent='✓'}})}App.Effects.playClick()},
        startExam:async function(){
            if(App.Login && !App.Login.isLoggedIn()){App.Toast.show('请先登录','warning');App.Login.openModal();return}
            var bankIds=App.Questions.getSelectedBankIds();
            var isLottery=this.currentMode==='lottery';
            if(bankIds.length===0&&!isLottery){App.Toast.show('请至少选择一个题库','warning');return}
            var students=App.Storage.getStudents();
            if(students.length===0){App.Toast.show('请先添加学生','warning');return}
            var mode=this.currentMode;
            var pType=this.participationType;
            var selectedIds=this.getSelectedStudentIds();
            var groupNames=[];
            var examStudents;
            var isPractice=mode==='practice';
            var isSmart=mode==='smart';
            if(isLottery)pType='personal';
            if(isPractice){
                if(selectedIds.length!==1){App.Toast.show('练习模式请选择1名学生','warning');return}
                if(bankIds.length!==1){App.Toast.show('练习模式请选择1个题库','warning');return}
                var savedProgress=App.Storage.getExamProgress();
                if(savedProgress&&savedProgress.mode==='practice'&&savedProgress._bankIds&&savedProgress._bankIds.length>0){
                    var savedBankId=savedProgress._bankIds[0];
                    var savedStudentId=savedProgress.currentStudentId||(savedProgress.students&&savedProgress.students[0]?savedProgress.students[0].id:null);
                    if(savedBankId===bankIds[0]&&savedStudentId===selectedIds[0]){
                        var answered=savedProgress.results?savedProgress.results.length:0;
                        var total=savedProgress.questions?savedProgress.questions.length:0;
                        var body='<p style="text-align:center;font-size:1.1em;padding:12px 0">检测到上次未完成的练习进度<br>已完成 <b style="color:var(--accent-1)">'+answered+'/'+total+'</b> 题<br><span style="color:var(--text-muted);font-size:0.9em">是否继续上次进度？</span></p>';
                        var footer='<button class="btn-secondary" onclick="App.Modal.close();App.Exam._startFreshPractice()">重新开始</button><button class="btn-glow" onclick="App.Modal.close();App.Exam._resumePractice()">🔄 继续练习</button>';
                        App.Modal.open('📝 发现未完成进度',body,footer);
                        return;
                    }
                }
            }
            if(pType==='group'){
                groupNames=this.getSelectedGroupNames();
                if(groupNames.length<1){App.Toast.show('请至少选择1个小组','warning');return}
                if(mode==='pk'&&groupNames.length<2){App.Toast.show('PK模式请至少选择2个小组','warning');return}
                var groupStudentIds=[];
                groupNames.forEach(function(gn){students.forEach(function(s){if(s.group===gn)groupStudentIds.push(s.id)})});
                selectedIds=groupStudentIds;
                if(selectedIds.length<1){App.Toast.show('所选小组中没有学生','warning');return}
            }else{
                if(mode==='pk'){
                    if(selectedIds.length<2){App.Toast.show('PK请至少选择2名选手','warning');return}
                    if(selectedIds.length>8){App.Toast.show('PK最多8名选手','warning');return}
                }else if(!isPractice){
                    if(selectedIds.length===0)selectedIds=students.map(function(s){return s.id});
                }
            }
            examStudents=students.filter(function(s){return selectedIds.indexOf(s.id)!==-1});
            var banks=App.Storage.getBanks(),allQ=[];
            if(mode!=='lottery'){
            // 检查所选题库是否缺少题目内容（仅有索引），按需从云端下载
            var missingBanks=[];
            var fileIndex=JSON.parse(localStorage.getItem('exam_file_index')||'[]');
            bankIds.forEach(function(bid){
                var b=banks.find(function(x){return x.id===bid});
                if(!b){
                    // 本地banks中无此题库，但文件索引中有（云端题库），需要下载
                    var fi=fileIndex.find(function(x){return x.id===bid&&x.id.startsWith('QB_')});
                    if(fi){
                        // 先在banks中创建空壳条目，以便下载后填充（静默，不增加版本号）
                        b={id:bid,name:fi.name,description:'',questions:[],createdAt:Date.now()};
                        banks.push(b);
                        App.Storage._syncSilent=true;
                        try{App.Storage.setBanks(banks)}finally{App.Storage._syncSilent=false}
                        missingBanks.push(b);
                    }
                }else if(!b.questions||b.questions.length===0){
                    missingBanks.push(b);
                }
            });
            if(missingBanks.length>0&&App.Sync&&App.Sync.ready){
                App.Toast.show('正在下载题库内容（'+missingBanks.length+'个）...','info');
                for(var mi=0;mi<missingBanks.length;mi++){
                    var mb=missingBanks[mi];
                    var bankMetaKey=mb.id||mb.name;
                    // 串行下载，每个等待完成
                    App.Sync.postToFileManager({type:'downloadCloudFile',fileId:bankMetaKey});
                    // 等待题库内容下载到本地（轮询检查，最多等10秒）
                    var waitStart=Date.now();
                    while(Date.now()-waitStart<10000){
                        await new Promise(function(r){setTimeout(r,500)});
                        var freshBanks=App.Storage.getBanks();
                        var freshBank=freshBanks.find(function(x){return x.id===mb.id});
                        if(freshBank&&freshBank.questions&&freshBank.questions.length>0)break;
                    }
                }
                banks=App.Storage.getBanks();
            }
            bankIds.forEach(function(bid){var b=banks.find(function(x){return x.id===bid});if(b&&b.questions)allQ=allQ.concat(b.questions)});
            if(allQ.length===0){App.Toast.show('所选题库中没有题目','warning');return}
            }
            var timeLimit=0;
            var autoNext=App.Storage.getSettings().autoNext!==false;
            var baseInput=document.getElementById('exam-base-timeout-inline');
            var charInput=document.getElementById('exam-char-timeout-inline');
            if(baseInput||charInput){
                var s=App.Storage.getSettings();
                if(baseInput)s.baseTimeout=parseFloat(baseInput.value)||0;
                if(charInput)s.charTimeoutCompensation=parseFloat(charInput.value)||0;
                s.lastMode=mode;
                s.lastParticipationType=this.participationType;
                s.lastPlayerOrder=document.getElementById('exam-player-order').value;
                s.lastQuestionOrder=document.getElementById('exam-question-order').value;
                s.lastAvgQuestions=parseInt(document.getElementById('exam-avg-questions').value)||5;
                s.lastGroupRotation=document.getElementById('exam-group-rotation').value;
                App.Storage.setSettings(s);
            }
            var playerOrder=document.getElementById('exam-player-order').value;
            if(!isPractice&&!isSmart&&!isLottery){
                if(playerOrder==='fair'&&examStudents.length<3){App.Toast.show('公平随机至少需要3人','warning');return}
                if(playerOrder==='random'&&examStudents.length<2){App.Toast.show('真随机至少需要2人','warning');return}
            }
            var questionOrder=document.getElementById('exam-question-order').value;
            var avgQuestions=(isPractice||isLottery)?0:(parseInt(document.getElementById('exam-avg-questions').value)||5);
            var groupRotation=document.getElementById('exam-group-rotation').value;
            var LOTTERY_MAX_DRAWS=500;
            var totalQuestionsNeeded,questionPool;
            if(isPractice){
                questionPool=allQ.slice().sort(function(){return Math.random()-0.5});
                totalQuestionsNeeded=questionPool.length;
            }else if(isLottery){
                totalQuestionsNeeded=LOTTERY_MAX_DRAWS;
                questionPool=this._buildLotteryQuestionPool(LOTTERY_MAX_DRAWS);
            }else{
                totalQuestionsNeeded=avgQuestions*examStudents.length;
                questionPool=this._buildQuestionPool(allQ,totalQuestionsNeeded,questionOrder);
            }
            var playerQueue;
            // 过滤今日缺勤的学生（所有模式通用）
            var settings=App.Storage.getSettings();
            var absenceEnabled=settings.absenceCompensation!==false;
            var today=new Date();var todayStr=today.getFullYear()+'-'+(today.getMonth()+1)+'-'+today.getDate();
            var availableStudents=examStudents;
            if(absenceEnabled&&!isPractice){
                availableStudents=examStudents.filter(function(s){
                    var absence=App.Storage.getAbsence(s.id);
                    if(!absence)return true;
                    return absence.lastAbsentDate!==todayStr;
                });
                if(availableStudents.length===0)availableStudents=examStudents;  // 全部缺勤则不过滤
            }
            if(isPractice){
                playerQueue=[];
                for(var pi=0;pi<totalQuestionsNeeded;pi++)playerQueue.push(availableStudents[0]);
            }else if(isSmart){
                playerOrder='smart';
                playerQueue=this._buildSmartPlayerQueue(availableStudents,totalQuestionsNeeded);
            }else if(isLottery){
                var lrSel=document.getElementById('exam-lottery-random');
                var lotteryMode=lrSel?lrSel.value:'fairCycle';
                var st_lr=App.Storage.getSettings();st_lr.lastLotteryRandom=lotteryMode;App.Storage.setSettings(st_lr);
                playerOrder='random';
                playerQueue=(lotteryMode==='fairCycle')?this._buildFairLotteryQueue(availableStudents,totalQuestionsNeeded):this._buildLotteryQueue(availableStudents,totalQuestionsNeeded);
            }else{
                playerQueue=this._buildPlayerQueue(availableStudents,playerOrder,totalQuestionsNeeded,pType,groupNames,groupRotation);
            }
            var exam={mode:mode,participationType:pType,questions:questionPool,timeLimit:timeLimit,autoNext:autoNext,students:examStudents,currentIndex:0,results:[],playerScores:{},totalEarned:0,playerQueue:playerQueue,queueIndex:0,avgQuestions:avgQuestions,groupNames:groupNames,groupRotation:groupRotation,playerOrder:isPractice?'order':playerOrder,_pointsPerQ:isPractice?this._getInitialPointsPerQ(examStudents[0].id,bankIds[0]||''):0};
            if(isSmart){
                exam._smartProbMap=this._calcSmartProbPoints(examStudents);
            }
            if(pType==='group'){
                var groupMap={};examStudents.forEach(function(s){var g=s.group||'未分组';if(!groupMap[g])groupMap[g]=[];groupMap[g].push(s)});
                exam.groupMap=groupMap;exam.groupScores={};
                Object.keys(groupMap).forEach(function(g){exam.groupScores[g]=0});
            }
            examStudents.forEach(function(s){exam.playerScores[s.id]=0});
            this.currentExam=exam;
            document.getElementById('exam-setup').classList.add('hidden');
            document.getElementById('exam-drawing').classList.add('hidden');
            document.getElementById('exam-playing').classList.add('hidden');
            document.getElementById('exam-play-sidebar').classList.remove('hidden');
            if(!document.fullscreenElement){
                document.documentElement.requestFullscreen().catch(function(){});
            }
            this._nextPlayer();
        },
        _buildQuestionPool:function(allQ,needed,order){
            if(order==='fair'){
                var pool=[];var idx=0;
                while(pool.length<needed){
                    var batch=allQ.slice().sort(function(){return Math.random()-0.5});
                    for(var i=0;i<batch.length&&pool.length<needed;i++){pool.push(batch[i])}
                }
                return pool;
            }else{
                var pool=[];
                for(var i=0;i<needed;i++){pool.push(allQ[Math.floor(Math.random()*allQ.length)])}
                return pool;
            }
        },
        _buildPlayerQueue:function(students,order,needed,pType,groupNames,groupRotation){
            if(pType==='group'){
                var groupMap={};
                students.forEach(function(s){var g=s.group||'未分组';if(!groupMap[g])groupMap[g]=[];groupMap[g].push(s)});
                var orderedGroups=groupNames.filter(function(g){return groupMap[g]});
                var shuffledGroups={};
                orderedGroups.forEach(function(g){shuffledGroups[g]=groupMap[g].slice().sort(function(){return Math.random()-0.5})});
                var queue=[];var gIdx=0;var inIdx={};
                orderedGroups.forEach(function(g){inIdx[g]=0});
                if(groupRotation==='alternate'){
                    while(queue.length<needed){
                        var g=orderedGroups[gIdx%orderedGroups.length];
                        var members=shuffledGroups[g];
                        if(members&&members.length>0){
                            queue.push(members[inIdx[g]%members.length]);
                            inIdx[g]++;
                        }
                        gIdx++;
                        var allDone=true;
                        for(var k in inIdx){if(inIdx[k]<needed){allDone=false;break}}
                        if(allDone)break;
                    }
                }else{
                    orderedGroups.forEach(function(g){
                        var members=shuffledGroups[g];
                        var count=0;
                        while(count<needed){
                            queue.push(members[count%members.length]);
                            count++;
                        }
                    });
                }
                return queue;
            }else{
                if(order==='order'){
                    var queue=[];var idx=0;
                    while(queue.length<needed){
                        queue.push(students[idx%students.length]);
                        idx++;
                    }
                    return queue;
                }else if(order==='fair'){
                    var queue=[];var shuffled=students.slice().sort(function(){return Math.random()-0.5});
                    var idx=0;
                    while(queue.length<needed){
                        queue.push(shuffled[idx%shuffled.length]);
                        idx++;
                    }
                    return queue;
                }else{
                    var queue=[];
                    for(var i=0;i<needed;i++){queue.push(students[Math.floor(Math.random()*students.length)])}
                    return queue;
                }
            }
        },
        _buildLotteryQuestionPool:function(needed){
            var pool=[];
            for(var i=0;i<needed;i++){pool.push({id:genId(),text:'',options:{}})}
            return pool;
        },
        _buildLotteryQueue:function(students,needed){
            var queue=[];
            for(var i=0;i<needed;i++){queue.push(students[Math.floor(Math.random()*students.length)])}
            return queue;
        },
        _buildFairLotteryQueue:function(students,needed){
            var queue=[];var batch=[];var idx=0;
            for(var i=0;i<needed;i++){
                if(idx>=batch.length){
                    batch=students.slice().sort(function(){return Math.random()-0.5});
                    idx=0;
                }
                queue.push(batch[idx]);idx++;
            }
            return queue;
        },
        _calcSmartProbPoints:function(students){
            var settings=App.Storage.getSettings();
            var intensity=settings.smartIntensity||5;
            var absenceEnabled=settings.absenceCompensation!==false;
            var today=new Date();var todayStr=today.getFullYear()+'-'+(today.getMonth()+1)+'-'+today.getDate();
            var yesterday=new Date(today);yesterday.setDate(yesterday.getDate()-1);
            var yesterdayStr=yesterday.getFullYear()+'-'+(yesterday.getMonth()+1)+'-'+yesterday.getDate();
            var statsArr=[];
            students.forEach(function(s){
                var st=getStudentStats(s.id);
                statsArr.push({id:s.id,accuracy:st.accuracy,totalCount:st.totalCount});
            });
            statsArr.sort(function(a,b){
                if(a.totalCount===0&&b.totalCount===0)return 0;
                if(a.totalCount===0)return 1;
                if(b.totalCount===0)return -1;
                return b.accuracy-a.accuracy;
            });
            var rankMap={};
            for(var i=0;i<statsArr.length;i++){
                rankMap[statsArr[i].id]=i+1;
            }
            var probMap={};
            students.forEach(function(s){
                var rank=rankMap[s.id]||students.length;
                var baseProb=100+(rank-1)*intensity;
                // 缺勤补偿：昨日缺勤的学生概率翻倍（线性增长）
                if(absenceEnabled){
                    var absence=App.Storage.getAbsence(s.id);
                    if(absence&&absence.consecutiveDays>0){
                        var lastDate=absence.lastAbsentDate||'';
                        var attendedDate=absence.attendedDate||'';
                        if(lastDate===todayStr){
                            // 今日缺勤，后面会被过滤，不调整概率
                        }else if(attendedDate===todayStr){
                            // 今日已出勤，当日维持高概率
                            baseProb=baseProb*(absence.consecutiveDays||1);
                        }else if(lastDate===yesterdayStr){
                            // 昨日缺勤，今日首次抽取必中 + 概率倍增
                            baseProb=baseProb*(absence.consecutiveDays||1);
                        }
                        // 其他情况（缺勤更早且今日未出勤）→ 正常概率
                    }
                }
                probMap[s.id]=baseProb;
            }.bind(this));
            return probMap;
        },
        _buildSmartPlayerQueue:function(students,needed){
            var settings=App.Storage.getSettings();
            var absenceEnabled=settings.absenceCompensation!==false;
            var today=new Date();var todayStr=today.getFullYear()+'-'+(today.getMonth()+1)+'-'+today.getDate();
            var yesterday=new Date(today);yesterday.setDate(yesterday.getDate()-1);
            var yesterdayStr=yesterday.getFullYear()+'-'+(yesterday.getMonth()+1)+'-'+yesterday.getDate();
            // 过滤今日缺勤的学生
            var availableStudents=students;
            if(absenceEnabled){
                availableStudents=students.filter(function(s){
                    var absence=App.Storage.getAbsence(s.id);
                    if(!absence)return true;
                    return absence.lastAbsentDate!==todayStr;
                });
                if(availableStudents.length===0)availableStudents=students;  // 全部缺勤则不过滤
            }
            var probMap=this._calcSmartProbPoints(availableStudents);
            // 检查是否有昨日缺勤的学生需要"首次必中"
            var mustPick=null;
            if(absenceEnabled){
                for(var i=0;i<availableStudents.length;i++){
                    var s=availableStudents[i];
                    var absence=App.Storage.getAbsence(s.id);
                    if(absence&&absence.lastAbsentDate===yesterdayStr){
                        // 检查今日是否已被抽取过（非缺勤）
                        var todayAnswered=this.currentExam?this.currentExam.results.filter(function(r){return r.studentId===s.id&&!r.isAbsent}):[];
                        if(todayAnswered.length===0){
                            mustPick=s;break;  // 首个昨日缺勤且今日未答题的学生必中
                        }
                    }
                }
            }
            var queue=[];
            if(mustPick){
                queue.push(mustPick);
                needed--;
            }
            var totalProb=0;
            availableStudents.forEach(function(s){totalProb+=probMap[s.id]||100});
            for(var i=0;i<needed;i++){
                var rand=Math.random()*totalProb;
                var cum=0;
                for(var j=0;j<availableStudents.length;j++){
                    cum+=probMap[availableStudents[j].id]||100;
                    if(rand<=cum){queue.push(availableStudents[j]);break}
                }
                if(queue.length<=i+ (mustPick?1:0))queue.push(availableStudents[availableStudents.length-1]);
            }
            return queue;
        },
        _getSmartPointsPerQ:function(studentId){
            var exam=this.currentExam;
            if(!exam)return 1;
            var students=exam.students;
            var probMap=exam._smartProbMap||this._calcSmartProbPoints(students);
            var probPoints=probMap[studentId]||100;
            var basePoints=10;
            return Math.max(1,Math.floor(basePoints/probPoints*100));
        },
        _updateSmartPreview:function(){
            var intensityInput=document.getElementById('exam-smart-intensity');
            var previewEl=document.getElementById('smart-preview');
            var valueEl=document.getElementById('smart-intensity-value');
            if(!intensityInput||!previewEl)return;
            var intensity=parseInt(intensityInput.value)||5;
            if(valueEl)valueEl.textContent=intensity;
            var students=App.Storage.getStudents();
            var lastProb=100+(students.length-1)*intensity;
            previewEl.textContent='末名概率点数：'+lastProb+'（'+students.length+'人）';
            var settings=App.Storage.getSettings();
            settings.smartIntensity=intensity;
            App.Storage.setSettings(settings);
        },
        _nextPlayer:function(){
            var exam=this.currentExam;
            if(exam.queueIndex>=exam.playerQueue.length||exam.currentIndex>=exam.questions.length){
                this.showResult();return;
            }
            var student=exam.playerQueue[exam.queueIndex];
            exam.currentStudent=student;
            exam.queueIndex++;
            exam.answered=false;
            if(exam.mode==='lottery'){exam.playerScores[student.id]=(exam.playerScores[student.id]||0)+1}
            this.renderWarReport(false);
            var settings=App.Storage.getSettings();
            var needDraw=settings.drawAnimation!==false&&exam.students.length>1&&exam.playerOrder!=='order';
            if(needDraw){
                document.getElementById('exam-drawing').classList.remove('hidden');
                document.getElementById('exam-playing').classList.add('hidden');
                this.startDrawing();
            }else{
                this.showQuestion();
            }
        },
        startDrawing:function(){var students=this.currentExam.students;if(students.length===0)return;var settings=App.Storage.getSettings();var drawDuration=(settings.drawDuration||3)*1000;var card=document.getElementById('drawing-card');var avatar=document.getElementById('drawing-avatar');var nameEl=document.getElementById('drawing-name');var avMap=buildAvatarCharMap(students);card.classList.add('spinning');card.classList.remove('revealed');App.Effects.playDrumRoll();var self=this,startTime=Date.now(),stopped=false;var finalStudent=this.currentExam.currentStudent;function animate(){var rs=students[Math.floor(Math.random()*students.length)];nameEl.textContent=rs.name;if(rs.avatar){avatar.innerHTML='<img src="'+rs.avatar+'">'}else{avatar.innerHTML='';avatar.textContent=avMap[rs.id]||rs.name.charAt(0)}var elapsed=Date.now()-startTime;var progress=Math.min(elapsed/drawDuration,1);if(progress>=1||stopped){setTimeout(function(){card.classList.remove('spinning');card.classList.add('revealed');nameEl.textContent=finalStudent.name;if(finalStudent.avatar){avatar.innerHTML='<img src="'+finalStudent.avatar+'">'}else{avatar.innerHTML='';avatar.textContent=avMap[finalStudent.id]||finalStudent.name.charAt(0)}App.Effects.playFanfare();App.Effects.spawnConfetti(window.innerWidth/2,window.innerHeight/3,80);setTimeout(function(){self.showQuestion()},1800)},300);return}var delay=50+progress*200;setTimeout(animate,delay)}animate();this._drawingStop=function(){stopped=true}},
        stopDrawing:function(){if(this._drawingStop){this._drawingStop();this._drawingStop=null}},
        showQuestion:function(){
            document.getElementById('exam-drawing').classList.add('hidden');
            document.getElementById('exam-playing').classList.remove('hidden');
            var hc=document.querySelector('.home-container');if(hc)hc.classList.add('in-exam');
            var exam=this.currentExam;
            var labels=window.ParticipationLabels||{};
            var label=(labels[exam.participationType]&&labels[exam.participationType][exam.mode])||exam.mode;
            var navMode=document.getElementById('nav-exam-mode');if(navMode){navMode.textContent=label;navMode.classList.remove('hidden')}
            var navEnd=document.getElementById('nav-exam-end');if(navEnd)navEnd.classList.remove('hidden');
            var student=exam.currentStudent;var question=exam.questions[exam.currentIndex];var st=getStudentStats(student.id);var level=getLevel(st.totalPoints);var avMap=buildAvatarCharMap(exam.students);
            document.getElementById('exam-avatar').innerHTML=student.avatar?'<img src="'+student.avatar+'">':(avMap[student.id]||student.name.charAt(0));
            document.getElementById('exam-student-name').textContent=student.name;
            document.getElementById('exam-student-group').textContent=student.group?'('+student.group+')':'';
            document.getElementById('exam-student-level').textContent=level.name;
            document.getElementById('exam-student-comment').textContent=level.comment;
            document.getElementById('exam-student-points').textContent=exam.mode==='practice'?'待结算：'+(exam.playerScores[student.id]||0)+'⭐':exam.mode==='smart'?'本场：'+(exam.playerScores[student.id]||0)+'⭐  累计：'+st.totalPoints+'⭐  概率：'+(exam._smartProbMap?exam._smartProbMap[student.id]:100)+'  分值：'+this._getSmartPointsPerQ(student.id):'本场：'+(exam.playerScores[student.id]||0)+'⭐  累计：'+st.totalPoints+'⭐';
            document.getElementById('exam-progress-text').textContent='第 '+(exam.currentIndex+1)+'/'+exam.questions.length+' 题 · 人均 '+(Math.round(exam.results.length/exam.students.length*10)/10)+'/'+exam.avgQuestions;
            document.getElementById('question-text').textContent=question.text;
            document.getElementById('question-options').innerHTML=this.renderOptionsHTML(question);
            var settings=App.Storage.getSettings();
            var cardEl=document.getElementById('question-card');
            if(cardEl&&settings.questionFontSize)cardEl.style.fontSize=settings.questionFontSize+'px';
            var nameEl=document.getElementById('exam-student-name');
            if(nameEl&&settings.studentNameFontSize)nameEl.style.fontSize=settings.studentNameFontSize+'px';
            var groupEl=document.getElementById('exam-student-group');
            if(groupEl&&settings.studentInfoFontSize)groupEl.style.fontSize=settings.studentInfoFontSize+'px';
            var levelEl=document.getElementById('exam-student-level');
            if(levelEl&&settings.studentInfoFontSize)levelEl.style.fontSize=settings.studentInfoFontSize+'px';
            var commentEl=document.getElementById('exam-student-comment');
            if(commentEl&&settings.studentInfoFontSize)commentEl.style.fontSize=settings.studentInfoFontSize+'px';
            var pointsEl=document.getElementById('exam-student-points');
            if(pointsEl&&settings.studentInfoFontSize)pointsEl.style.fontSize=settings.studentInfoFontSize+'px';
            if(exam.mode==='lottery'){
                document.getElementById('exam-student-points').textContent='本场已抽 '+(exam.playerScores[student.id]||0)+' 次';
                document.getElementById('exam-progress-text').textContent='第 '+(exam.currentIndex+1)+'/'+exam.questions.length+' 签 · 已抽 '+(exam.results.length)+' 人';
                document.getElementById('timer-bar').style.display='none';
                document.getElementById('exam-timer').style.display='none';
                document.getElementById('question-text').textContent='📣 请老师现场口头出题（与题库无关）';
                document.getElementById('question-options').innerHTML='<div class="lottery-hint">抽签结果已定格，学生作答后点击下方「下一签 →」继续</div>';
                var undoBtnL=document.getElementById('btn-undo-answer');if(undoBtnL)undoBtnL.style.display='none';
                var absentBtnL=document.getElementById('btn-absent');if(absentBtnL&&exam.students.length>1)absentBtnL.style.display='';
                var nextBtnL=document.getElementById('btn-next-question');
                nextBtnL.style.display='';nextBtnL.textContent='下一签 →';
                nextBtnL.onclick=function(){App.Exam.nextQuestion()};
                return;
            }
            document.getElementById('btn-next-question').style.display='none';
            var undoBtn2=document.getElementById('btn-undo-answer');if(undoBtn2)undoBtn2.style.display='none';
            var absentBtn2=document.getElementById('btn-absent');if(absentBtn2&&exam.students.length>1)absentBtn2.style.display='';
            this.startTimer(question.text);
        },
        toggleFullscreen:function(){
            if(!document.fullscreenElement){
                document.documentElement.requestFullscreen().catch(function(){});
            }else{
                document.exitFullscreen().catch(function(){});
            }
        },
        renderWarReport:function(expandCurrentGroup){
            var exam=this.currentExam;
            var container=document.getElementById('war-report-list');
            var sidebarTitle=document.getElementById('sidebar-title');
            if(!container)return;
            var settings=App.Storage.getSettings();
            var wrFs=settings.warReportFontSize||12;
            container.style.fontSize=wrFs+'px';
            if(exam.mode==='lottery'){
                sidebarTitle.textContent='📊 抽签记录';
                var lStudents=exam.students.slice().sort(function(a,b){return(exam.playerScores[b.id]||0)-(exam.playerScores[a.id]||0)});
                var lHtml='';
                lStudents.forEach(function(s){
                    var lCount=exam.playerScores[s.id]||0;
                    var lIsCurrent=exam.currentStudent&&s.id===exam.currentStudent.id;
                    lHtml+='<div class="war-report-personal-item'+(lIsCurrent?' current-player':'')+'">';
                    lHtml+='<span class="rp-name">'+(s.avatar?'<img src="'+s.avatar+'" style="width:18px;height:18px;border-radius:50%;vertical-align:middle;margin-right:4px">':'')+s.name+'</span>';
                    lHtml+='<span class="rp-correct">'+lCount+' 次</span>';
                    lHtml+='</div>';
                });
                container.innerHTML=lHtml;
                return;
            }
            if(exam.participationType==='group'){
                sidebarTitle.textContent='📊 小组战报';
                var gMap=exam.groupMap||{};
                var gScores=exam.groupScores||{};
                var gNames=exam.groupNames||Object.keys(gMap);
                var sortedGroups=gNames.slice().sort(function(a,b){return(gScores[b]||0)-(gScores[a]||0)});
                var groupCount=sortedGroups.length;
                var defaultShowCount=this._calcGroupMemberDisplay(groupCount);
                var html='';
                sortedGroups.forEach(function(gn,rank){
                    var score=gScores[gn]||0;
                    var isCurrent=exam.currentStudent&&exam.currentStudent.group===gn;
                    var members=(gMap[gn]||[]).slice().sort(function(a,b){return(exam.playerScores[b.id]||0)-(exam.playerScores[a.id]||0)});
                    var isExpanded=expandCurrentGroup&&isCurrent;
                    html+='<div class="war-report-item'+(isCurrent?' current-group':'')+(isExpanded?' expanded':'')+'">';
                    html+='<div class="war-report-header"><span class="war-report-group-name">'+(rank<3?['🥇','🥈','🥉'][rank]:'')+' '+gn+'</span><span class="war-report-group-score">'+score+' 分</span></div>';
                    html+='<div class="war-report-top3">';
                    var showCount=isExpanded?members.length:Math.min(defaultShowCount,members.length);
                    for(var i=0;i<showCount;i++){
                        var m=members[i];
                        var ps=exam.playerScores[m.id]||0;
                        html+='<div class="war-report-member"><span class="rank-badge">'+(i+1)+'</span><span class="member-name">'+m.name+'</span><span class="member-score">'+ps+'</span></div>';
                    }
                    html+='</div>';
                    if(!isExpanded&&members.length>defaultShowCount){
                        html+='<div class="war-report-expand-hint">共'+members.length+'人 · 答题后展开</div>';
                    }
                    html+='</div>';
                });
                container.innerHTML=html;
            }else{
                sidebarTitle.textContent='📊 个人战报';
                var students=exam.students.slice().sort(function(a,b){return(exam.playerScores[b.id]||0)-(exam.playerScores[a.id]||0)});
                var html='';
                students.forEach(function(s,i){
                    var isCurrent=exam.currentStudent&&s.id===exam.currentStudent.id;
                    var ps=exam.playerScores[s.id]||0;
                    var sr=exam.results.filter(function(r){return r.studentId===s.id});
                    var correct=sr.filter(function(r){return r.correct}).length;
                    html+='<div class="war-report-personal-item'+(isCurrent?' current-player':'')+'">';
                    html+='<span class="rp-rank">'+(i+1)+'</span>';
                    html+='<span class="rp-name">'+(s.avatar?'<img src="'+s.avatar+'" style="width:18px;height:18px;border-radius:50%;vertical-align:middle;margin-right:4px">':'')+s.name+'</span>';
                    html+='<span class="rp-correct">'+correct+'/'+sr.length+'</span>';
                    html+='<span class="rp-score">'+ps+'</span>';
                    html+='</div>';
                });
                container.innerHTML=html;
            }
        },
        startTimer:function(questionText){
            var self=this,exam=this.currentExam;
            var tbEl=document.getElementById('timer-bar');if(tbEl)tbEl.style.display='';
            var tEl2=document.getElementById('exam-timer');if(tEl2)tEl2.style.display='';
            var fill=document.getElementById('timer-fill'),timerEl=document.getElementById('exam-timer');
            if(this.timerInterval)clearInterval(this.timerInterval);
            var timeLimit=this.calcTimeout(questionText);
            if(timeLimit<=0){fill.style.width='100%';fill.classList.remove('warning');timerEl.textContent='不限时';return}
            this.timeLeft=timeLimit;var totalTime=timeLimit;
            fill.style.width='100%';fill.classList.remove('warning');timerEl.textContent=this.timeLeft+'s';
            this.timerInterval=setInterval(function(){self.timeLeft--;var pct=(self.timeLeft/totalTime)*100;fill.style.width=pct+'%';timerEl.textContent=self.timeLeft+'s';if(self.timeLeft<=5){fill.classList.add('warning');App.Effects.playCountdown()}if(self.timeLeft<=0){clearInterval(self.timerInterval);self.timeUp()}},1000);
        },
        timeUp:function(){var exam=this.currentExam,question=exam.questions[exam.currentIndex];if(exam.answered)return;exam.answered=true;var correctAnswer=this.getEffectiveAnswer(question);document.querySelectorAll('.option-btn').forEach(function(btn){btn.classList.add('disabled');if(btn.dataset.option===correctAnswer)btn.classList.add('correct')});exam.results.push({studentId:exam.currentStudent.id,questionId:question.id,correct:false,pointsEarned:0,selectedOption:'超时'});App.Effects.playTimeUp();App.Effects.showScorePopup(0,false);this.renderWarReport(true);this._saveProgress();this.showNextButton()},
        selectOption:function(option){
            var exam=this.currentExam,question=exam.questions[exam.currentIndex];
            if(exam.answered)return;
            exam.answered=true;
            if(this.timerInterval)clearInterval(this.timerInterval);
            var correctAnswer=this.getEffectiveAnswer(question);
            var isCorrect=option===correctAnswer;
            document.querySelectorAll('.option-btn').forEach(function(btn){btn.classList.add('disabled');if(btn.dataset.option===correctAnswer)btn.classList.add('correct');if(btn.dataset.option===option&&!isCorrect)btn.classList.add('wrong')});
            var pointsEarned=0;
            if(isCorrect){
                if(exam.mode==='practice'){
                    pointsEarned=exam._pointsPerQ||10;
                }else if(exam.mode==='smart'){
                    pointsEarned=this._getSmartPointsPerQ(exam.currentStudent.id);
                }else{
                    pointsEarned=this._calcBasePoints(exam.mode);
                }
                exam.totalEarned+=pointsEarned;
                exam.playerScores[exam.currentStudent.id]=(exam.playerScores[exam.currentStudent.id]||0)+pointsEarned;
                if(exam.participationType==='group'){var g=exam.currentStudent.group||'未分组';exam.groupScores[g]=(exam.groupScores[g]||0)+pointsEarned}
                App.Effects.playCorrect();App.Effects.spawnConfetti(window.innerWidth/2,window.innerHeight/2,40);
                if(exam.mode==='practice'){
                    App.Effects.showScorePopup(pointsEarned,true,'待结算');
                    document.getElementById('exam-student-points').textContent='待结算：'+(exam.playerScores[exam.currentStudent.id]||0)+'⭐';
                }else if(exam.mode==='smart'){
                    App.Effects.showScorePopup(pointsEarned,true);
                    var st=getStudentStats(exam.currentStudent.id);var tempPts=st.totalPoints+pointsEarned;var lv=getLevel(tempPts);document.getElementById('exam-student-points').textContent='本场：'+(exam.playerScores[exam.currentStudent.id]||0)+'⭐  累计：'+tempPts+'⭐  概率：'+(exam._smartProbMap?exam._smartProbMap[exam.currentStudent.id]:100)+'  分值：'+pointsEarned;document.getElementById('exam-student-level').textContent=lv.name;document.getElementById('exam-student-comment').textContent=lv.comment
                }else{
                    App.Effects.showScorePopup(pointsEarned,true);
                    var st=getStudentStats(exam.currentStudent.id);var tempPts=st.totalPoints+pointsEarned;var lv=getLevel(tempPts);document.getElementById('exam-student-points').textContent='本场：'+(exam.playerScores[exam.currentStudent.id]||0)+'⭐  累计：'+tempPts+'⭐';document.getElementById('exam-student-level').textContent=lv.name;document.getElementById('exam-student-comment').textContent=lv.comment
                }
            }else{App.Effects.playWrong();App.Effects.showScorePopup(0,false)}
            exam.results.push({studentId:exam.currentStudent.id,questionId:question.id,correct:isCorrect,pointsEarned:pointsEarned,selectedOption:option});
            // 学生出勤答题，清除缺勤连续计数（次日恢复正常概率）
            var absence=App.Storage.getAbsence(exam.currentStudent.id);
            if(absence&&absence.consecutiveDays>0){
                var today=new Date();var todayStr=today.getFullYear()+'-'+(today.getMonth()+1)+'-'+today.getDate();
                absence.attendedDate=todayStr;  // 标记今日已出勤
                App.Storage.setAbsence(exam.currentStudent.id,absence);
            }
            // 智能模式：每5人答题后更新概率映射
            if(exam.mode==='smart'&&exam._smartProbMap&&exam.results.length%5===0){
                exam._smartProbMap=this._calcSmartProbPoints(exam.students);
            }
            this.renderWarReport(true);this._saveProgress();this.showNextButton();
        },
        _getInitialPointsPerQ:function(studentId,bankId){
            var DEFAULT_PPQ=10;
            var wrongSet=App.Storage.getWrongSet(studentId,bankId);
            if(wrongSet&&wrongSet.lastInitialPPQ){
                return Math.max(1,Math.floor(wrongSet.lastInitialPPQ/2));
            }
            return DEFAULT_PPQ;
        },
        _calcBasePoints:function(mode){
            if(mode==='farm')return 10;
            if(mode==='challenge')return 5;
            if(mode==='pk')return 5;
            if(mode==='practice')return 10;
            if(mode==='smart')return 10;
            return 10;
        },
        _calcGroupMemberDisplay:function(groupCount){
            if(groupCount>=9)return 3;
            if(groupCount>=7)return 4;
            if(groupCount>=5)return 5;
            if(groupCount>=3)return 6;
            return 8;
        },
        _saveProgress:function(){
            var exam=this.currentExam;
            if(!exam)return;
            var bankIds=App.Questions.getSelectedBankIds();
            var progress={
                mode:exam.mode,
                participationType:exam.participationType,
                questions:exam.questions,
                timeLimit:exam.timeLimit,
                autoNext:exam.autoNext,
                students:exam.students,
                currentIndex:exam.currentIndex,
                results:exam.results,
                playerScores:exam.playerScores,
                totalEarned:exam.totalEarned,
                playerQueue:exam.playerQueue,
                queueIndex:exam.queueIndex,
                avgQuestions:exam.avgQuestions,
                groupNames:exam.groupNames,
                groupRotation:exam.groupRotation,
                groupMap:exam.groupMap||null,
                groupScores:exam.groupScores||null,
                currentStudentId:exam.currentStudent?exam.currentStudent.id:null,
                _pointsPerQ:exam._pointsPerQ||null,
                _isRetry:exam._isRetry||false,
                _bankIds:bankIds,
                _smartProbMap:exam._smartProbMap||null,
                savedAt:Date.now()
            };
            App.Storage.setExamProgress(progress);
        },
        showNextButton:function(){var exam=this.currentExam;var btn=document.getElementById('btn-next-question');var undoBtn=document.getElementById('btn-undo-answer');var absentBtn=document.getElementById('btn-absent');btn.style.display='';undoBtn.style.display='';if(absentBtn&&exam.students.length>1)absentBtn.style.display='';var isLast=exam.currentIndex>=exam.questions.length-1;btn.textContent=isLast?'查看结果 →':'下一题 →';btn.onclick=isLast?function(){App.Exam.showResult()}:function(){App.Exam.nextQuestion()};if(exam.autoNext){var delay=(App.Storage.getSettings().autoNextDelay||3)*1000;exam._autoNextTimer=setTimeout(isLast?function(){App.Exam.showResult()}:function(){App.Exam.nextQuestion()},delay)}},
        undoAnswer:function(){
            var exam=this.currentExam;if(!exam||!exam.answered)return;
            if(exam._autoNextTimer){clearTimeout(exam._autoNextTimer);exam._autoNextTimer=null}
            var lastResult=exam.results.pop();
            if(!lastResult)return;
            if(lastResult.pointsEarned>0){
                exam.totalEarned-=lastResult.pointsEarned;
                exam.playerScores[lastResult.studentId]=(exam.playerScores[lastResult.studentId]||0)-lastResult.pointsEarned;
                if(exam.participationType==='group'){var g=exam.currentStudent.group||'未分组';exam.groupScores[g]=(exam.groupScores[g]||0)-lastResult.pointsEarned}
            }
            // 撤销出勤标记
            if(!lastResult.isAbsent){
                var absence=App.Storage.getAbsence(lastResult.studentId);
                if(absence&&absence.attendedDate){
                    var today=new Date();var todayStr=today.getFullYear()+'-'+(today.getMonth()+1)+'-'+today.getDate();
                    if(absence.attendedDate===todayStr)delete absence.attendedDate;
                    App.Storage.setAbsence(lastResult.studentId,absence);
                }
            }
            exam.answered=false;
            document.querySelectorAll('.option-btn').forEach(function(btn){btn.classList.remove('disabled','correct','wrong')});
            var undoBtn=document.getElementById('btn-undo-answer');undoBtn.style.display='none';
            var absentBtn=document.getElementById('btn-absent');if(absentBtn)absentBtn.style.display='none';
            var nextBtn=document.getElementById('btn-next-question');nextBtn.style.display='none';
            if(exam.mode==='practice'){
                document.getElementById('exam-student-points').textContent='待结算：'+(exam.playerScores[exam.currentStudent.id]||0)+'⭐';
            }else{
                var st=getStudentStats(exam.currentStudent.id);var lv=getLevel(st.totalPoints);
                document.getElementById('exam-student-points').textContent='本场：'+(exam.playerScores[exam.currentStudent.id]||0)+'⭐  累计：'+st.totalPoints+'⭐';
                document.getElementById('exam-student-level').textContent=lv.name;
                document.getElementById('exam-student-comment').textContent=lv.comment;
            }
            this.renderWarReport(false);this._saveProgress();
            var question=exam.questions[exam.currentIndex];
            this.startTimer(question.text);
            App.Toast.show('已撤销，请重新作答','info');
        },
        markAbsent:function(){
            var exam=this.currentExam;if(!exam||!exam.currentStudent)return;
            if(exam._autoNextTimer){clearTimeout(exam._autoNextTimer);exam._autoNextTimer=null}
            if(this.timerInterval){clearInterval(this.timerInterval);this.timerInterval=null}
            var student=exam.currentStudent;
            var settings=App.Storage.getSettings();
            if(settings.absenceCompensation===false){
                App.Toast.show('缺勤补偿未启用','warning');return;
            }
            // 隐藏按钮
            var absentBtn=document.getElementById('btn-absent');if(absentBtn)absentBtn.style.display='none';
            var undoBtn=document.getElementById('btn-undo-answer');if(undoBtn)undoBtn.style.display='none';
            var nextBtn=document.getElementById('btn-next-question');if(nextBtn)nextBtn.style.display='none';
            // 记录缺勤
            var today=new Date();var todayStr=today.getFullYear()+'-'+(today.getMonth()+1)+'-'+today.getDate();
            var absence=App.Storage.getAbsence(student.id);
            // 如果今日已出勤答题，不允许再标记缺勤
            if(absence&&absence.attendedDate===todayStr){
                App.Toast.show(student.name+' 今日已出勤，无法标记缺勤','warning');return;
            }
            if(absence){
                var lastDate=absence.lastAbsentDate||'';
                // 判断是否连续缺勤（上次缺勤是昨天）
                var yesterday=new Date(today);yesterday.setDate(yesterday.getDate()-1);
                var yesterdayStr=yesterday.getFullYear()+'-'+(yesterday.getMonth()+1)+'-'+yesterday.getDate();
                if(lastDate===yesterdayStr){
                    absence.consecutiveDays=(absence.consecutiveDays||1)+1;
                }else if(lastDate!==todayStr){
                    absence.consecutiveDays=1;
                }
                absence.lastAbsentDate=todayStr;
                absence.absentDates=absence.absentDates||[];
                if(absence.absentDates.indexOf(todayStr)===-1)absence.absentDates.push(todayStr);
            }else{
                absence={lastAbsentDate:todayStr,consecutiveDays:1,absentDates:[todayStr]};
            }
            App.Storage.setAbsence(student.id,absence);
            // 记录缺勤结果（0分，不计入正确率）
            exam.results.push({studentId:student.id,questionId:exam.questions[exam.currentIndex]?exam.questions[exam.currentIndex].id:'',correct:false,pointsEarned:0,selectedOption:'缺勤',isAbsent:true});
            this.renderWarReport(true);this._saveProgress();
            App.Toast.show(student.name+' 已标记缺勤（连续'+absence.consecutiveDays+'天）','warning');
            // 跳到下一题
            exam.currentIndex++;
            if(exam.currentIndex>=exam.questions.length){this.showResult();return}
            this._nextPlayer();
        },
        nextQuestion:function(){
            var exam=this.currentExam;if(exam._autoNextTimer){clearTimeout(exam._autoNextTimer);exam._autoNextTimer=null}exam.currentIndex++;
            if(exam.currentIndex>=exam.questions.length){this.showResult();return}
            this._nextPlayer();
        },
        endExam:function(){var exam=this.currentExam;var isPractice=exam&&exam.mode==='practice';var answered=exam?exam.results.length:0;var total=exam?exam.questions.length:0;var isMidway=isPractice&&answered<total;var msg=isMidway?'确定要暂停练习吗？进度将自动保存，下次可继续！':'确定要结束本次挑战吗？';var body='<p style="text-align:center;font-size:1.1em;padding:12px 0">'+msg+'</p>';var footer='<button class="btn-secondary" onclick="App.Modal.close()">取消</button><button class="'+(isMidway?'btn-primary':'btn-danger')+'" onclick="App.Modal.close();App.Exam._doEndExam()">'+(isMidway?'💾 保存并退出':'⏹ 结束挑战')+'</button>';App.Modal.open(isMidway?'💾 暂停练习':'⏹ 结束挑战',body,footer)},
        _doEndExam:function(){
            if(this.timerInterval)clearInterval(this.timerInterval);
            var navMode=document.getElementById('nav-exam-mode');if(navMode)navMode.classList.add('hidden');
            var navEnd=document.getElementById('nav-exam-end');if(navEnd)navEnd.classList.add('hidden');
            var exam=this.currentExam;
            if(exam&&exam.mode==='practice'){
                var answered=exam.results.length;
                var total=exam.questions.length;
                if(answered<total){
                    this._saveProgress();
                    var body='<p style="text-align:center;font-size:1.1em;padding:12px 0">练习进度已保存！<br>已完成 <b style="color:var(--accent-1)">'+answered+'/'+total+'</b> 题<br><span style="color:var(--text-muted);font-size:0.9em">下次进入可继续完成剩余题目</span></p>';
                    var footer='<button class="btn-primary" onclick="App.Modal.close();App.Exam._exitToHome()">确定</button>';
                    App.Modal.open('📝 练习已保存',body,footer);
                    return;
                }
            }
            this.showResult();
        },
        _exitToHome:function(){
            var exam=this.currentExam;
            if(exam)exam._ended=true;
            if(this.timerInterval)clearInterval(this.timerInterval);
            if(document.fullscreenElement)document.exitFullscreen().catch(function(){});
            document.getElementById('exam-playing').classList.add('hidden');
            document.getElementById('exam-play-sidebar').classList.add('hidden');
            document.getElementById('exam-drawing').classList.add('hidden');
            var hc=document.querySelector('.home-container');if(hc)hc.classList.remove('in-exam');
            this.currentExam=null;
        },
        _resumePractice:function(){
            var progress=App.Storage.getExamProgress();
            if(!progress||progress.mode!=='practice')return;
            var exam={
                mode:progress.mode,
                participationType:progress.participationType,
                questions:progress.questions,
                timeLimit:progress.timeLimit,
                autoNext:progress.autoNext,
                students:progress.students,
                currentIndex:progress.currentIndex,
                results:progress.results||[],
                playerScores:progress.playerScores||{},
                totalEarned:progress.totalEarned||0,
                playerQueue:progress.playerQueue,
                queueIndex:progress.queueIndex,
                avgQuestions:progress.avgQuestions,
                groupNames:progress.groupNames||[],
                groupRotation:progress.groupRotation||'alternate',
                groupMap:progress.groupMap||null,
                groupScores:progress.groupScores||null,
                _pointsPerQ:progress._pointsPerQ||null,
                _isRetry:progress._isRetry||false,
                _smartProbMap:progress._smartProbMap||null
            };
            if(progress.currentStudentId){
                var cs=exam.students.find(function(s){return s.id===progress.currentStudentId});
                if(cs)exam.currentStudent=cs;
            }
            this.currentExam=exam;
            document.getElementById('exam-setup').classList.add('hidden');
            document.getElementById('exam-drawing').classList.add('hidden');
            document.getElementById('exam-playing').classList.remove('hidden');
            document.getElementById('exam-play-sidebar').classList.remove('hidden');
            var hc=document.querySelector('.home-container');if(hc)hc.classList.add('in-exam');
            var labels=window.ParticipationLabels||{};
            var label=(labels[exam.participationType]&&labels[exam.participationType][exam.mode])||exam.mode;
            var navMode=document.getElementById('nav-exam-mode');if(navMode){navMode.textContent=label;navMode.classList.remove('hidden')}
            var navEnd=document.getElementById('nav-exam-end');if(navEnd)navEnd.classList.remove('hidden');
            if(!document.fullscreenElement){document.documentElement.requestFullscreen().catch(function(){})}
            this.renderWarReport(false);
            this.showQuestion();
            App.Toast.show('已恢复练习进度','success');
        },
        _startFreshPractice:function(){
            App.Storage.clearExamProgress();
            this.startExam();
        },
        _startPracticeRetry:function(){
            var record=this._lastPracticeRecord;
            if(!record||!record.studentResults)return;
            var sid=Object.keys(record.studentResults)[0];
            var student=App.Storage.getStudents().find(function(s){return s.id===sid});
            if(!student){App.Toast.show('学生不存在','warning');return}
            var bankIds=App.Questions.getSelectedBankIds();
            if(bankIds.length===0){App.Toast.show('题库未选择','warning');return}
            var banks=App.Storage.getBanks(),allQ=[];
            bankIds.forEach(function(bid){var b=banks.find(function(x){return x.id===bid});if(b&&b.questions)allQ=allQ.concat(b.questions)});
            if(allQ.length===0){App.Toast.show('题库中没有题目','warning');return}
            var bankId=bankIds[0]||'';
            var wrongSet=App.Storage.getWrongSet(sid,bankId);
            var questionPool;
            if(wrongSet&&wrongSet.wrongQuestionIds&&wrongSet.wrongQuestionIds.length>0){
                var wrongIds=wrongSet.wrongQuestionIds;
                var wrongQs=allQ.filter(function(q){return wrongIds.indexOf(q.id)!==-1});
                var correctQs=allQ.filter(function(q){return wrongIds.indexOf(q.id)===-1});
                var shuffledCorrect=correctQs.sort(function(){return Math.random()-0.5});
                var distractors=shuffledCorrect.slice(0,Math.min(wrongQs.length,correctQs.length));
                questionPool=wrongQs.concat(distractors).sort(function(){return Math.random()-0.5});
            }else{
                questionPool=allQ.slice().sort(function(){return Math.random()-0.5});
            }
            var nextPointsPerQ=wrongSet?wrongSet.nextPointsPerQ||5:5;
            var examStudents=[student];
            var retryQueue=[];for(var ri=0;ri<questionPool.length;ri++)retryQueue.push(examStudents[0]);
            var exam={mode:'practice',participationType:'personal',questions:questionPool,timeLimit:0,autoNext:App.Storage.getSettings().autoNext!==false,students:examStudents,currentIndex:0,results:[],playerScores:{},totalEarned:0,playerQueue:retryQueue,queueIndex:0,avgQuestions:0,groupNames:[],groupRotation:'alternate',playerOrder:'order',_isRetry:true,_pointsPerQ:nextPointsPerQ};
            examStudents.forEach(function(s){exam.playerScores[s.id]=0});
            this.currentExam=exam;
            document.getElementById('exam-setup').classList.add('hidden');
            document.getElementById('exam-drawing').classList.add('hidden');
            document.getElementById('exam-playing').classList.add('hidden');
            document.getElementById('exam-play-sidebar').classList.remove('hidden');
            if(!document.fullscreenElement){document.documentElement.requestFullscreen().catch(function(){})}
            this._nextPlayer();
        },
        showResult:function(){
            var exam=this.currentExam;if(!exam||exam._ended)return;exam._ended=true;
            if(this.timerInterval)clearInterval(this.timerInterval);
            if(exam._autoNextTimer){clearTimeout(exam._autoNextTimer);exam._autoNextTimer=null}
            document.getElementById('exam-drawing').classList.add('hidden');
            document.getElementById('exam-playing').classList.add('hidden');
            document.getElementById('exam-play-sidebar').classList.add('hidden');
            var hc=document.querySelector('.home-container');if(hc)hc.classList.remove('in-exam');
            if(exam.mode==='lottery'){
                this.currentExam=null;
                App.Storage.clearExamProgress();
                var totalDraws=0;for(var lk in exam.playerScores){totalDraws+=exam.playerScores[lk]||0}
                var navModeL=document.getElementById('nav-exam-mode');if(navModeL)navModeL.classList.add('hidden');
                var navEndL=document.getElementById('nav-exam-end');if(navEndL)navEndL.classList.add('hidden');
                if(document.fullscreenElement)document.exitFullscreen().catch(function(){});
                App.switchView('home');
                var modeSelL=document.getElementById('exam-mode-select');if(modeSelL)modeSelL.classList.remove('hidden');
                App.Toast.show('抽签结束，共 '+totalDraws+' 签','info');
                return;
            }
            var exam=this.currentExam;var correct=exam.results.filter(function(r){return r.correct}).length;
            var banks=App.Storage.getBanks();var bankNames=[];var bankIds=App.Questions.getSelectedBankIds();
            bankIds.forEach(function(bid){var b=banks.find(function(x){return x.id===bid});if(b)bankNames.push(b.name)});
            var studentResults={};
            exam.students.forEach(function(s){studentResults[s.id]={id:s.id,name:s.name,avatar:s.avatar,group:s.group||'',correctCount:0,totalCount:0,pointsEarned:0}});
            exam.results.forEach(function(r){if(studentResults[r.studentId]&&!r.isAbsent){studentResults[r.studentId].totalCount++;if(r.correct){studentResults[r.studentId].correctCount++;studentResults[r.studentId].pointsEarned+=r.pointsEarned}}});
            // 判断是否全员参与：个人模式下所有学生都参与，或小组模式下所有小组都参与
            var allParticipants=false;
            if(exam.participationType!=='group'){
                var allStudents=App.Storage.getStudents();
                if(exam.students.length===allStudents.length)allParticipants=true;
            }else if(exam.groupNames&&exam.groupNames.length>0){
                var allGroups=App.Storage.getGroups();
                if(exam.groupNames.length===allGroups.length)allParticipants=true;
            }
            // 全员参与时，移除未答题（totalCount===0）的人的数据，节省存储
            if(allParticipants){
                var sids=Object.keys(studentResults);
                for(var ri=0;ri<sids.length;ri++){
                    if(studentResults[sids[ri]].totalCount===0)delete studentResults[sids[ri]];
                }
            }
            if(exam.mode==='practice'){
                var allCorrect=correct===exam.questions.length;
                var sid=exam.students[0].id;
                var bid=bankIds[0]||'';
                var ppq=exam._pointsPerQ||10;
                var pendingPoints=correct*ppq;
                var currentWrongSet=App.Storage.getWrongSet(sid,bid);
                var originalPending=currentWrongSet?currentWrongSet.pendingPoints||0:0;
                var currentInitialPPQ=exam._isRetry?(currentWrongSet&&currentWrongSet.lastInitialPPQ?currentWrongSet.lastInitialPPQ:ppq):ppq;
                if(allCorrect){
                    var totalPending=originalPending+pendingPoints;
                    exam.results.forEach(function(r){r.pointsEarned=r.correct?ppq:0});
                    studentResults[sid].pointsEarned=totalPending;
                    exam.playerScores[sid]=totalPending;
                    exam.totalEarned=totalPending;
                    App.Storage.setWrongSet(sid,bid,{wrongQuestionIds:[],lastAttempt:Date.now(),bankId:bid,pendingPoints:0,nextPointsPerQ:0,lastInitialPPQ:currentInitialPPQ});
                }else{
                    exam.results.forEach(function(r){r.pointsEarned=0});
                    studentResults[sid].pointsEarned=0;
                    exam.playerScores[sid]=0;
                    exam.totalEarned=0;
                    var wrongIds=[];
                    exam.results.forEach(function(r){if(!r.correct&&r.questionId)wrongIds.push(r.questionId)});
                    var nextPPQ=Math.max(1,Math.floor(ppq/2));
                    App.Storage.setWrongSet(sid,bid,{wrongQuestionIds:wrongIds,lastAttempt:Date.now(),bankId:bid,pendingPoints:originalPending+pendingPoints,nextPointsPerQ:nextPPQ,lastInitialPPQ:currentInitialPPQ});
                }
                var record={id:genId(),date:Date.now(),mode:exam.mode,participationType:exam.participationType||'personal',bankNames:bankNames,totalQuestions:exam.questions.length,totalCorrect:correct,totalEarned:exam.totalEarned,studentResults:studentResults,practicePassed:allCorrect,allParticipants:allParticipants||undefined};
                var records=App.Storage.getRecords();
                records.push(record);App.Storage.setRecords(records);
                if(allCorrect)App.Sync.syncNow();
                this.currentExam=null;
                App.Storage.clearExamProgress();
                if(allCorrect){
                    App.Effects.playVictory();App.Effects.spawnConfetti(window.innerWidth/2,window.innerHeight/3,80);
                    if(exam._isRetry){
                        App.Toast.show('补考通过！获得 '+exam.totalEarned+'⭐','success');
                    }
                    App.Exam.showRoundLeaderboard(record);
                }else{
                    App.Effects.playWrong();
                    var wrongCount=exam.questions.length-correct;
                    var wrongSet3=App.Storage.getWrongSet(sid,bid);
                    var totalPendingPts=wrongSet3?wrongSet3.pendingPoints||pendingPoints:pendingPoints;
                    var body='<p style="text-align:center;font-size:1.1em;padding:12px 0">答对 <b style="color:var(--success)">'+correct+'</b>/'+exam.questions.length+' 题<br>待结算积分：<b style="color:var(--accent-1)">'+totalPendingPts+'⭐</b>（暂不计入）<br><br>补考全对即可拿回 <b>'+totalPendingPts+'⭐</b><br><span style="color:var(--text-muted);font-size:0.9em">补考将重做错题并混入等量已答对题目</span></p>';
                    var footer='<button class="btn-secondary" onclick="App.Modal.close();App.Exam.showRoundLeaderboard(App.Exam._lastPracticeRecord)">查看详情</button><button class="btn-glow" onclick="App.Modal.close();App.Exam._startPracticeRetry()">🔄 立即补考</button>';
                    App.Exam._lastPracticeRecord=record;
                    App.Modal.open('📝 练习未通过',body,footer);
                }
                return;
            }
            if(exam.mode==='challenge'){
                var sIds=Object.keys(studentResults);
                sIds.forEach(function(sid){
                    var sr=studentResults[sid];
                    if(sr.totalCount>0){
                        // 用真实比率判定分档，避免四舍五入把 99.5%→100、84.5%→85 造成错档
                        var ratio=sr.correctCount/sr.totalCount;
                        var bonusPerQ=0;
                        if(ratio===1)bonusPerQ=15;
                        else if(ratio>=0.95)bonusPerQ=12;
                        else if(ratio>=0.90)bonusPerQ=9;
                        else if(ratio>=0.85)bonusPerQ=6;
                        if(bonusPerQ>0){
                            var bonus=bonusPerQ*sr.correctCount;
                            sr.pointsEarned+=bonus;
                            exam.playerScores[sid]=(exam.playerScores[sid]||0)+bonus;
                            exam.totalEarned+=bonus;
                        }
                    }
                });
            }
            if(exam.mode==='pk'){
                var pScores=exam.playerScores||{};
                var pkIds=Object.keys(studentResults).filter(function(sid){return pScores[sid]!==undefined});
                if(pkIds.length>0){
                    var topId=pkIds.sort(function(a,b){return(pScores[b]||0)-(pScores[a]||0)})[0];
                    var pkBonus=studentResults[topId].correctCount*10;
                    if(pkBonus>0){
                        studentResults[topId].pointsEarned+=pkBonus;
                        exam.playerScores[topId]=(exam.playerScores[topId]||0)+pkBonus;
                        exam.totalEarned+=pkBonus;
                    }
                }
            }
            if(exam.participationType==='group'&&exam.groupScores){
                var gScores=exam.groupScores;
                var gNames=Object.keys(gScores);
                if(gNames.length>0){
                    var topGroup=gNames.sort(function(a,b){return gScores[b]-gScores[a]})[0];
                    var groupBonusIds=Object.keys(studentResults).filter(function(sid){return studentResults[sid].group===topGroup});
                    groupBonusIds.forEach(function(sid){
                        var sr=studentResults[sid];
                        var bonus=sr.correctCount*5;
                        if(bonus>0){sr.pointsEarned+=bonus;exam.playerScores[sid]=(exam.playerScores[sid]||0)+bonus;exam.totalEarned+=bonus}
                    });
                }
            }
            var record={id:genId(),date:Date.now(),mode:exam.mode,participationType:exam.participationType||'personal',bankNames:bankNames,totalQuestions:exam.questions.length,totalCorrect:correct,totalEarned:exam.totalEarned,studentResults:studentResults,allParticipants:allParticipants||undefined};
            var records=App.Storage.getRecords();records.push(record);App.Storage.setRecords(records);this.currentExam=null;
            App.Storage.clearExamProgress();
            App.Sync.syncNow();
            App.Effects.playVictory();App.Effects.spawnConfetti(window.innerWidth/2,window.innerHeight/3,80);
            App.Exam.showRoundLeaderboard(record);
        },
        showRoundLeaderboard:function(record){
            this._showingRound=true;
            this._roundRecord=record;
            App.switchView('leaderboard');
            var empty=document.getElementById('leaderboard-empty');
            var container=document.querySelector('.leaderboard-container h2.section-title');
            empty.classList.remove('show');
            if(this._roundTimer){clearTimeout(this._roundTimer)}
            var self=this;
            if(record.participationType==='group'){
                this._roundPage='group';
                this._renderGroupRanking(record);
                if(container)container.textContent='🏆 本场小组积分榜';
                this._roundTimer=setTimeout(function(){
                    self._roundPage='group-winner';
                    self._renderGroupWinnerRanking(record);
                    if(container)container.textContent='🏆 获胜小组个人积分榜';
                    self._roundTimer=setTimeout(function(){self._showTotalLeaderboard()},5000);
                },5000);
            }else{
                this._roundPage='personal';
                this._renderPersonalRanking(record);
                if(container)container.textContent='🏆 本场排名';
                this._roundTimer=setTimeout(function(){self._showTotalLeaderboard()},5000);
            }
        },
        _showTotalLeaderboard:function(){
            if(this._roundTimer){clearTimeout(this._roundTimer);this._roundTimer=null}
            this._roundPage=null;
            App.Leaderboard.render();
            App.Students.render();
        },
        _renderGroupRanking:function(record){
            var podium=document.getElementById('leaderboard-podium');
            var list=document.getElementById('leaderboard-list');
            var srs=record.studentResults||{};
            var gScores={};
            Object.keys(srs).forEach(function(sid){var sr=srs[sid];if(sr.group){gScores[sr.group]=(gScores[sr.group]||0)+(sr.pointsEarned||0)}});
            var sortedGroups=Object.keys(gScores).filter(function(gn){return gScores[gn]>0}).sort(function(a,b){return gScores[b]-gScores[a]});
            var medals=['🥇','🥈','🥉'];
            var podiumOrder=[5,3,1,0,2,4,6];
            if(sortedGroups.length===0){
                podium.innerHTML='<div class="no-podium-hint">😔 无人上榜</div>';
                var hintHTML='<div class="round-leaderboard-hint" onclick="App.Exam._showTotalLeaderboard()">👆 点击查看总积分榜（5秒后自动跳转）</div>';
                list.innerHTML=hintHTML;
                return;
            }
            var podiumCount=Math.min(sortedGroups.length,7);
            var topN=sortedGroups.slice(0,podiumCount);
            var remaining=sortedGroups.slice(podiumCount);
            var baseRankHeights=[140,110,95,80,60,50,35];
            var rankHeights=baseRankHeights.slice();
            for(var ri=1;ri<topN.length;ri++){
                if(gScores[topN[ri]]===gScores[topN[ri-1]]){rankHeights[ri]=rankHeights[ri-1]}
            }
            var podiumHeights=[];
            for(var pi=0;pi<7;pi++){var ridx=podiumOrder[pi];podiumHeights.push(ridx<rankHeights.length?rankHeights[ridx]:0)}
            var podiumHTML='<div class="podium-stage">';
            for(var p=0;p<7;p++){
                var idx=podiumOrder[p];
                if(idx>=topN.length)continue;
                var gn=topN[idx];
                var h=podiumHeights[p];
                var rank=idx+1;
                var rankLabel=idx<3?medals[idx]:'#'+rank;
                podiumHTML+='<div class="podium-slot rank-'+rank+'">';
                podiumHTML+='<div class="podium-avatar">'+(idx<3?medals[idx]:'🏆')+'</div>';
                podiumHTML+='<div class="podium-name">'+gn+'</div>';
                podiumHTML+='<div class="podium-level">小组</div>';
                podiumHTML+='<div class="podium-points">⭐ '+gScores[gn]+'</div>';
                podiumHTML+='<div class="podium-bar" style="height:'+h+'px"></div>';
                podiumHTML+='<div class="podium-rank-label">'+rankLabel+'</div>';
                podiumHTML+='</div>';
            }
            podiumHTML+='</div>';
            podium.innerHTML=podiumHTML;
            var listHTML='';
            if(remaining.length>0){
                listHTML+='<div class="remaining-list"><div class="remaining-grid">';
                remaining.forEach(function(gn,i){
                    var rank=podiumCount+i+1;
                    listHTML+='<div class="flb-item"><div class="flb-rank">#'+rank+'</div><div class="flb-avatar">🏆</div><div class="flb-name">'+gn+'</div><div class="flb-level">小组</div><div class="flb-pts">⭐ '+gScores[gn]+'</div></div>';
                });
                listHTML+='</div></div>';
            }
            listHTML+='<div class="round-leaderboard-hint" onclick="App.Exam._showRoundPersonal()">👆 点击查看个人排名（5秒后自动跳转）</div>';
            list.innerHTML=listHTML;
        },
        _showRoundPersonal:function(){
            if(this._roundTimer){clearTimeout(this._roundTimer);this._roundTimer=null}
            this._roundPage='personal';
            this._renderPersonalRanking(this._roundRecord);
            var container=document.querySelector('.leaderboard-container h2.section-title');
            if(container)container.textContent='🏆 本场个人排名';
            var self=this;
            this._roundTimer=setTimeout(function(){self._showTotalLeaderboard()},5000);
        },
        _renderGroupWinnerRanking:function(record){
            var podium=document.getElementById('leaderboard-podium');
            var list=document.getElementById('leaderboard-list');
            var srs=record.studentResults||{};
            var gScores={};
            Object.keys(srs).forEach(function(sid){var sr=srs[sid];if(sr.group){gScores[sr.group]=(gScores[sr.group]||0)+(sr.pointsEarned||0)}});
            var gNames=Object.keys(gScores);
            if(gNames.length===0){podium.innerHTML='';list.innerHTML='';return}
            var topGroup=gNames.sort(function(a,b){return gScores[b]-gScores[a]})[0];
            var groupMembers=Object.keys(srs).filter(function(sid){return srs[sid].group===topGroup}).map(function(k){return srs[k]}).sort(function(a,b){
                return(b.pointsEarned||0)-(a.pointsEarned||0);
            });
            var avMap=buildAvatarCharMap(groupMembers);
            var medals=['🥇','🥈','🥉'];
            var podiumOrder=[5,3,1,0,2,4,6];
            if(groupMembers.length===0){
                podium.innerHTML='<div class="no-podium-hint">🏆 获胜小组：'+topGroup+'</div>';
                list.innerHTML='<div class="round-leaderboard-hint" onclick="App.Exam._showTotalLeaderboard()">👆 点击查看总积分榜（5秒后自动跳转）</div>';
                return;
            }
            var podiumCount=Math.min(groupMembers.length,7);
            var topN=groupMembers.slice(0,podiumCount);
            var remaining=groupMembers.slice(podiumCount);
            var baseRankHeights=[140,110,95,80,60,50,35];
            var rankHeights=baseRankHeights.slice(0,podiumCount);
            for(var ri=1;ri<topN.length;ri++){
                if(topN[ri].pointsEarned===topN[ri-1].pointsEarned){rankHeights[ri]=rankHeights[ri-1]}
            }
            var podiumHTML='<div class="podium-stage">';
            for(var p=0;p<7;p++){
                var idx=podiumOrder[p];
                if(idx>=topN.length)continue;
                var s=topN[idx];
                var h=idx<rankHeights.length?rankHeights[idx]:35;
                var rank=idx+1;
                var rankLabel=idx<3?medals[idx]:'#'+rank;
                var pts=s.pointsEarned||0;
                podiumHTML+='<div class="podium-slot rank-'+rank+'">';
                podiumHTML+='<div class="podium-avatar">'+(s.avatar?'<img src="'+s.avatar+'">':(avMap[s.id]||s.name.charAt(0)))+'</div>';
                podiumHTML+='<div class="podium-name">'+s.name+'</div>';
                podiumHTML+='<div class="podium-level">'+topGroup+'</div>';
                podiumHTML+='<div class="podium-points">⭐ '+pts+'</div>';
                podiumHTML+='<div class="podium-bar" style="height:'+h+'px"></div>';
                podiumHTML+='<div class="podium-rank-label">'+rankLabel+'</div>';
                podiumHTML+='</div>';
            }
            podiumHTML+='</div>';
            podium.innerHTML=podiumHTML;
            var listHTML='';
            if(remaining.length>0){
                listHTML+='<div class="remaining-list"><div class="remaining-grid">';
                remaining.forEach(function(s,i){
                    var rank=podiumCount+i+1;
                    var pts=s.pointsEarned||0;
                    listHTML+='<div class="flb-item"><div class="flb-rank">#'+rank+'</div><div class="flb-avatar">'+(s.avatar?'<img src="'+s.avatar+'">':(avMap[s.id]||s.name.charAt(0)))+'</div><div class="flb-name">'+s.name+'</div><div class="flb-level">'+topGroup+'</div><div class="flb-pts">⭐ '+pts+'</div></div>';
                });
                listHTML+='</div></div>';
            }
            listHTML+='<div class="round-leaderboard-hint" onclick="App.Exam._showTotalLeaderboard()">👆 点击查看总积分榜（5秒后自动跳转）</div>';
            list.innerHTML=listHTML;
        },
        _showRoundPersonalFromHistory:function(recordId){
            var records=App.Storage.getRecords();
            var rec=records.find(function(r){return r.id===recordId});
            if(!rec)return;
            this._renderPersonalRanking(rec);
            var container=document.querySelector('.leaderboard-container h2.section-title');
            var dateStr=new Date(rec.date).toLocaleString('zh-CN');
            if(container)container.textContent='🏆 历史积分榜 - '+dateStr+' 个人排名';
            var list=document.getElementById('leaderboard-list');
            var existing=list.innerHTML;
            list.innerHTML=existing+'<div class="round-leaderboard-hint" onclick="App.Leaderboard.render()">👆 点击返回总积分榜</div>';
        },
        _renderPersonalRanking:function(record){
            var podium=document.getElementById('leaderboard-podium');
            var list=document.getElementById('leaderboard-list');
            var srs=record.studentResults||{};
            var sorted=Object.keys(srs).map(function(k){return srs[k]}).sort(function(a,b){
                return(b.pointsEarned||0)-(a.pointsEarned||0);
            });
            var avMap=buildAvatarCharMap(sorted);
            var medals=['🥇','🥈','🥉'];
            var podiumOrder=[5,3,1,0,2,4,6];
            if(sorted.length===0){
                podium.innerHTML='<div class="no-podium-hint">😔 无人上榜</div>';
                list.innerHTML='<div class="round-leaderboard-hint" onclick="App.Exam._showTotalLeaderboard()">👆 点击查看总积分榜（5秒后自动跳转）</div>';
                return;
            }
            var podiumCount=Math.min(sorted.length,7);
            var topN=sorted.slice(0,podiumCount);
            var remaining=sorted.slice(podiumCount);
            var baseRankHeights=[140,110,95,80,60,50,35];
            var rankHeights=baseRankHeights.slice();
            for(var ri=1;ri<topN.length;ri++){
                if(topN[ri].pointsEarned===topN[ri-1].pointsEarned){rankHeights[ri]=rankHeights[ri-1]}
            }
            var podiumHeights=[];
            for(var pi=0;pi<7;pi++){var ridx=podiumOrder[pi];podiumHeights.push(ridx<rankHeights.length?rankHeights[ridx]:0)}
            var podiumHTML='<div class="podium-stage">';
            for(var p=0;p<7;p++){
                var idx=podiumOrder[p];
                if(idx>=topN.length)continue;
                var s=topN[idx];
                var score=s.pointsEarned||0;
                var h=podiumHeights[p];
                var rank=idx+1;
                var rankLabel=idx<3?medals[idx]:'#'+rank;
                podiumHTML+='<div class="podium-slot rank-'+rank+'">';
                podiumHTML+='<div class="podium-avatar">'+(s.avatar?'<img src="'+s.avatar+'">':(avMap[s.id]||s.name.charAt(0)))+'</div>';
                podiumHTML+='<div class="podium-name">'+s.name+'</div>';
                podiumHTML+='<div class="podium-level">'+(s.group||'')+'</div>';
                podiumHTML+='<div class="podium-points">⭐ '+score+'</div>';
                podiumHTML+='<div class="podium-bar" style="height:'+h+'px"></div>';
                podiumHTML+='<div class="podium-rank-label">'+rankLabel+'</div>';
                podiumHTML+='</div>';
            }
            podiumHTML+='</div>';
            podium.innerHTML=podiumHTML;
            var listHTML='';
            if(remaining.length>0){
                listHTML+='<div class="remaining-list"><div class="remaining-grid">';
                remaining.forEach(function(s,i){
                    var score=s.pointsEarned||0;
                    var rank=podiumCount+i+1;
                    listHTML+='<div class="flb-item"><div class="flb-rank">#'+rank+'</div><div class="flb-avatar">'+(s.avatar?'<img src="'+s.avatar+'">':(avMap[s.id]||s.name.charAt(0)))+'</div><div class="flb-name">'+s.name+'</div><div class="flb-level">'+(s.group||'')+'</div><div class="flb-pts">⭐ '+score+'</div></div>';
                });
                listHTML+='</div></div>';
            }
            listHTML+='<div class="round-leaderboard-hint" onclick="App.Exam._showTotalLeaderboard()">👆 点击查看总积分榜（5秒后自动跳转）</div>';
            list.innerHTML=listHTML;
        }
    };

    App.Records = {
        render:function(){
            var records=App.Storage.getRecords();var list=document.getElementById('records-list');var empty=document.getElementById('records-empty');
            if(records.length===0){list.innerHTML='';empty.classList.add('show');return}
            empty.classList.remove('show');records.sort(function(a,b){return b.date-a.date});
            var html='';
            records.forEach(function(rec){
                var modeLabel=rec.mode==='draw'?'🎲 多人挑战':rec.mode==='assign'?'👤 单人挑战':rec.mode==='pk'?'⚔️ PK':rec.mode==='farm'?'🌾 打野':rec.mode==='challenge'?'🎯 挑战':'🎮 未知';
                var dateStr=new Date(rec.date).toLocaleString('zh-CN');
                var srs=rec.studentResults||{};var sNames=Object.keys(srs).map(function(k){return srs[k].name});
                var partLabel=rec.allParticipants?' 👥全员':'';
                var nameStr=sNames.slice(0,3).join('、')+(sNames.length>3?'...':'');
                var titleText=dateStr+' '+modeLabel+partLabel+' '+nameStr;
                var totalQ=rec.totalQuestions||0;var totalC=rec.totalCorrect||0;var totalE=rec.totalEarned||0;
                html+='<div class="record-card" data-rid="'+rec.id+'">';
                html+='<div class="record-header"><div class="record-title" onclick="App.Records.toggleDetail(this.parentElement)">'+titleText+'</div>';
                html+='<div class="record-header-actions">';
                html+='<button class="record-view-btn" onclick="event.stopPropagation();App.Records.viewLeaderboard(\''+rec.id+'\')" title="查看积分榜">🏆</button>';
                html+='<button class="record-del-btn" onclick="event.stopPropagation();App.Records.deleteRecord(\''+rec.id+'\')" title="删除此记录">🗑️</button>';
                html+='</div></div>';
                html+='<div class="record-stats"><span class="record-stat">📝 <strong>'+totalQ+'</strong> 题</span><span class="record-stat">✅ <strong>'+totalC+'</strong> 对</span><span class="record-stat">⭐ <strong>'+totalE+'</strong> 分</span></div>';
                html+='<div class="record-detail">';
                var sKeys=Object.keys(srs);
                if(rec.mode==='group'||rec.participationType==='group'){
                    var gScores={};
                    sKeys.forEach(function(k){var sr=srs[k];if(sr.group){gScores[sr.group]=(gScores[sr.group]||0)+(sr.pointsEarned||0)}});
                    var sortedGroups=Object.keys(gScores).sort(function(a,b){return gScores[b]-gScores[a]});
                    sortedGroups.forEach(function(gn,i){
                        var medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':'';
                        html+='<div class="record-student-row"><span class="record-student-name">'+medal+' 🏆 '+gn+'</span><span class="record-student-score">'+gScores[gn]+' 分</span></div>';
                    });
                    var gSorted=sKeys.map(function(k){return srs[k]}).sort(function(a,b){return(b.pointsEarned||0)-(a.pointsEarned||0)});
                    gSorted.forEach(function(sr,i){
                        var pct=sr.totalCount>0?Math.round(sr.correctCount/sr.totalCount*100):0;
                        var pctColor=pct>=90?'var(--success)':pct>=60?'var(--gold)':'var(--danger)';
                        var medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':'';
                        html+='<div class="record-student-row" style="flex-wrap:wrap;gap:4px 0">';
                        html+='<div style="display:flex;justify-content:space-between;width:100%;align-items:center">';
                        html+='<span class="record-student-name">'+medal+' '+sr.name+(sr.group?' <span style="font-size:12px;color:var(--text-muted)">('+sr.group+')</span>':'')+'</span>';
                        html+='<span class="record-student-score">+'+sr.pointsEarned+' ⭐</span>';
                        html+='</div>';
                        html+='<div style="display:flex;gap:12px;width:100%;font-size:12px;color:var(--text-muted);padding-left:24px">';
                        html+='<span>答题 '+sr.totalCount+' 题</span>';
                        html+='<span>答对 '+sr.correctCount+' 题</span>';
                        html+='<span>正确率 <b style="color:'+pctColor+'">'+pct+'%</b></span>';
                        html+='</div>';
                        html+='</div>';
                    });
                }else{
                    var sorted=sKeys.map(function(k){return srs[k]}).sort(function(a,b){return(b.pointsEarned||0)-(a.pointsEarned||0)});
                    sorted.forEach(function(sr,i){
                        var pct=sr.totalCount>0?Math.round(sr.correctCount/sr.totalCount*100):0;
                        var pctColor=pct>=90?'var(--success)':pct>=60?'var(--gold)':'var(--danger)';
                        var medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':'';
                        html+='<div class="record-student-row" style="flex-wrap:wrap;gap:4px 0">';
                        html+='<div style="display:flex;justify-content:space-between;width:100%;align-items:center">';
                        html+='<span class="record-student-name">'+medal+' '+sr.name+'</span>';
                        html+='<span class="record-student-score">+'+sr.pointsEarned+' ⭐</span>';
                        html+='</div>';
                        html+='<div style="display:flex;gap:12px;width:100%;font-size:12px;color:var(--text-muted);padding-left:24px">';
                        html+='<span>答题 '+sr.totalCount+' 题</span>';
                        html+='<span>答对 '+sr.correctCount+' 题</span>';
                        html+='<span>正确率 <b style="color:'+pctColor+'">'+pct+'%</b></span>';
                        html+='</div>';
                        html+='</div>';
                    });
                }
                html+='</div></div>';
            });
            list.innerHTML=html;
        },
        toggleDetail:function(el){el.classList.toggle('expanded')},
        viewLeaderboard:function(recordId){
            var records=App.Storage.getRecords();
            var rec=records.find(function(r){return r.id===recordId});
            if(!rec){App.Toast.show('记录不存在','error');return}
            App.Exam._showingRound=true;
            App.switchView('leaderboard');
            var empty=document.getElementById('leaderboard-empty');
            var container=document.querySelector('.leaderboard-container h2.section-title');
            empty.classList.remove('show');
            var dateStr=new Date(rec.date).toLocaleString('zh-CN');
            var modeLabel=rec.mode==='draw'?'多人挑战':rec.mode==='assign'?'单人挑战':rec.mode==='pk'?'PK':rec.mode==='farm'?'打野':rec.mode==='challenge'?'挑战':'未知';
            if(rec.mode==='group'||rec.participationType==='group'){
                if(container)container.textContent='🏆 历史积分榜 - '+dateStr+' '+modeLabel;
                App.Exam._renderGroupRanking(rec);
                var list=document.getElementById('leaderboard-list');
                var existing=list.innerHTML;
                list.innerHTML=existing+'<div class="round-leaderboard-hint" onclick="App.Exam._showRoundPersonalFromHistory(\''+recordId+'\')">👆 点击查看个人排名</div>';
            }else{
                if(container)container.textContent='🏆 历史积分榜 - '+dateStr+' '+modeLabel;
                App.Exam._renderPersonalRanking(rec);
                var list=document.getElementById('leaderboard-list');
                var existing=list.innerHTML;
                list.innerHTML=existing+'<div class="round-leaderboard-hint" onclick="App.Leaderboard.render()">👆 点击返回总积分榜</div>';
            }
        },
        deleteRecord:function(recordId){
            if(!confirm('确定要删除此记录吗？删除后相关学生的积分将重新计算。'))return;
            var records=App.Storage.getRecords();records=records.filter(function(r){return r.id!==recordId});
            App.Storage.setRecords(records);
            this.render();App.Leaderboard.render();App.Students.render();
            App.Toast.show('记录已删除，积分已更新','info');
        },
        getStudentHistory:function(studentId){
            var records=App.Storage.getRecords();var history=[];
            records.forEach(function(rec){var srs=rec.studentResults||{};if(srs[studentId]){history.push({date:rec.date,mode:rec.mode,bankNames:rec.bankNames||[],correctCount:srs[studentId].correctCount,totalCount:srs[studentId].totalCount,pointsEarned:srs[studentId].pointsEarned})}else if(rec.allParticipants){history.push({date:rec.date,mode:rec.mode,bankNames:rec.bankNames||[],correctCount:0,totalCount:0,pointsEarned:0,notDrawn:true})}});
            history.sort(function(a,b){return b.date-a.date});return history;
        }
    };

    App.Leaderboard = {
        render:function(){
            var students=App.Storage.getStudents();
            var empty=document.getElementById('leaderboard-empty');
            var podium=document.getElementById('leaderboard-podium');
            var container=document.querySelector('.leaderboard-container h2.section-title');
            if(container)container.textContent='🏆 个人总积分榜';
            var list=document.getElementById('leaderboard-list');
            if(students.length===0){podium.innerHTML='';list.innerHTML='';empty.classList.add('show');return}
            empty.classList.remove('show');
            var statsMap=getAllStudentStats();
            var enriched=students.map(function(s){
                var st=statsMap[s.id]||{totalPoints:0};
                return{id:s.id,name:s.name,avatar:s.avatar,totalPoints:st.totalPoints};
            });
            var sorted=enriched.slice().sort(function(a,b){return b.totalPoints-a.totalPoints});
            var avMap=buildAvatarCharMap(sorted);
            var podiumCount=Math.min(sorted.length,7);
            var topN=sorted.slice(0,podiumCount);
            var remaining=sorted.slice(podiumCount);
            var podiumOrder=[5,3,1,0,2,4,6];
            var baseRankHeights=[140,110,95,80,60,50,35];
            var rankHeights=baseRankHeights.slice();
            for(var ri=1;ri<topN.length;ri++){
                if(topN[ri].totalPoints===topN[ri-1].totalPoints){rankHeights[ri]=rankHeights[ri-1]}
            }
            var podiumHeights=[];
            for(var pi=0;pi<7;pi++){var ridx=podiumOrder[pi];podiumHeights.push(ridx<rankHeights.length?rankHeights[ridx]:0)}
            var medals=['🥇','🥈','🥉'];
            var podiumHTML='<div class="podium-stage">';
            for(var p=0;p<7;p++){
                var idx=podiumOrder[p];
                if(idx>=topN.length)continue;
                var s=topN[idx];
                var lv=getLevel(s.totalPoints);
                var h=podiumHeights[p];
                var rank=idx+1;
                var rankLabel=idx<3?medals[idx]:'#'+rank;
                var rankClass='rank-'+rank;
                podiumHTML+='<div class="podium-slot '+rankClass+'">';
                podiumHTML+='<div class="podium-avatar" onclick="App.Students.showPointsDetail(\''+s.id+'\')" title="点击查看详情">'+(s.avatar?'<img src="'+s.avatar+'">':(avMap[s.id]||s.name.charAt(0)))+'</div>';
                podiumHTML+='<div class="podium-name">'+s.name+'</div>';
                podiumHTML+='<div class="podium-level">'+lv.name+'</div>';
                podiumHTML+='<div class="podium-points">⭐ '+s.totalPoints+'</div>';
                podiumHTML+='<div class="podium-bar" style="height:'+h+'px"></div>';
                podiumHTML+='<div class="podium-rank-label">'+rankLabel+'</div>';
                podiumHTML+='</div>';
            }
            podiumHTML+='</div>';
            podium.innerHTML=podiumHTML;
            var listHTML='';
            if(remaining.length>0){
                listHTML+='<div class="remaining-list"><div class="remaining-grid">';
                remaining.forEach(function(s,i){
                    var lv=getLevel(s.totalPoints);
                    var rank=podiumCount+i+1;
                    listHTML+='<div class="flb-item" onclick="App.Students.showPointsDetail(\''+s.id+'\')" title="点击查看详情">';
                    listHTML+='<div class="flb-rank">#'+rank+'</div>';
                    listHTML+='<div class="flb-avatar">'+(s.avatar?'<img src="'+s.avatar+'">':(avMap[s.id]||s.name.charAt(0)))+'</div>';
                    listHTML+='<div class="flb-name">'+s.name+'</div>';
                    listHTML+='<div class="flb-level">'+lv.name+'</div>';
                    listHTML+='<div class="flb-pts">⭐ '+s.totalPoints+'</div>';
                    listHTML+='</div>';
                });
                listHTML+='</div></div>';
            }
            list.innerHTML=listHTML;
        }
    };

    App.Settings = {
        switchTab:function(tab){
            document.querySelectorAll('.settings-tab').forEach(function(t){t.classList.remove('active')});
            document.querySelectorAll('.settings-panel').forEach(function(p){p.classList.remove('active')});
            var tabBtn=document.querySelector('.settings-tab[data-stab="'+tab+'"]');
            var panel=document.getElementById('stab-'+tab);
            if(tabBtn)tabBtn.classList.add('active');
            if(panel)panel.classList.add('active');
            if(tab==='records'){App.Records.render();this.updateIOCounts()}
            if(tab==='levels')this.renderLevels();
            if(tab==='sound')this.loadSoundSettings();
            if(tab==='ai')this.loadAISettings();
            if(tab==='exam')this.loadExamSettings();
            if(tab==='students')this.StudentMgmt.render();
            if(tab==='sync')this.loadSyncSettings();
        },
        renderLevels:function(){
            var settings=App.Storage.getSettings();
            var levels=settings.levels||[];
            var container=document.getElementById('level-settings');
            if(!container)return;
            var html='';
            levels.forEach(function(lv,i){
                html+='<div class="level-item">';
                html+='<input type="text" class="level-name-input" value="'+lv.name+'" data-idx="'+i+'" placeholder="等级名">';
                html+='<input type="number" class="level-pts-input" value="'+lv.minPoints+'" data-idx="'+i+'" placeholder="积分" min="0">';
                html+='<input type="text" class="level-comment-input" value="'+lv.comment+'" data-idx="'+i+'" placeholder="评语">';
                html+='<button class="btn-remove-level" onclick="App.Settings.removeLevel('+i+')">✕</button>';
                html+='</div>';
            });
            container.innerHTML=html;
        },
        addLevel:function(){
            var settings=App.Storage.getSettings();
            if(!settings.levels)settings.levels=[];
            var maxPts=0;
            settings.levels.forEach(function(l){if(l.minPoints>maxPts)maxPts=l.minPoints});
            settings.levels.push({name:'新等级',minPoints:maxPts+100,comment:'自定义等级评语'});
            App.Storage.setSettings(settings);
            this.renderLevels();
        },
        removeLevel:function(idx){
            var settings=App.Storage.getSettings();
            if(settings.levels.length<=1){App.Toast.show('至少保留一个等级','warning');return}
            settings.levels.splice(idx,1);
            App.Storage.setSettings(settings);
            this.renderLevels();
        },
        loadAISettings:function(){
            var settings=App.Storage.getSettings();
            var urlEl=document.getElementById('ai-api-url');
            var keyEl=document.getElementById('ai-api-key');
            var modelEl=document.getElementById('ai-model');
            if(urlEl)urlEl.value=settings.aiApiUrl||'';
            if(keyEl)keyEl.value=settings.aiApiKey||'';
            if(modelEl)modelEl.value=settings.aiModel||'';
        },
        loadExamSettings:function(){
            var settings=App.Storage.getSettings();
            var shuffleEl=document.getElementById('exam-shuffle-options');
            var baseEl=document.getElementById('exam-base-timeout');
            var charEl=document.getElementById('exam-char-timeout');
            var autoNextEl=document.getElementById('exam-auto-next');
            var autoNextDelayEl=document.getElementById('exam-auto-next-delay');
            var drawDurEl=document.getElementById('exam-draw-duration');
            var qFontEl=document.getElementById('exam-question-fontsize');
            var snFontEl=document.getElementById('exam-student-name-fontsize');
            var siFontEl=document.getElementById('exam-student-info-fontsize');
            var wrFontEl=document.getElementById('exam-warreport-fontsize');
            if(shuffleEl)shuffleEl.checked=settings.shuffleOptions!==false;
            var absenceEl=document.getElementById('exam-absence-compensation');
            if(absenceEl)absenceEl.checked=settings.absenceCompensation!==false;
            if(baseEl)baseEl.value=settings.baseTimeout!==undefined?settings.baseTimeout:30;
            if(charEl)charEl.value=settings.charTimeoutCompensation!==undefined?settings.charTimeoutCompensation:0.2;
            if(autoNextEl)autoNextEl.checked=settings.autoNext!==false;
            if(autoNextDelayEl)autoNextDelayEl.value=settings.autoNextDelay!==undefined?settings.autoNextDelay:3;
            var drawAnimEl=document.getElementById('exam-draw-animation');
            if(drawAnimEl)drawAnimEl.checked=settings.drawAnimation!==false;
            if(drawDurEl)drawDurEl.value=settings.drawDuration!==undefined?settings.drawDuration:3;
            if(qFontEl)qFontEl.value=settings.questionFontSize||30;
            if(snFontEl)snFontEl.value=settings.studentNameFontSize||35;
            if(siFontEl)siFontEl.value=settings.studentInfoFontSize||20;
            if(wrFontEl)wrFontEl.value=settings.warReportFontSize||20;
            this.updateTimeoutPreview();
            var self=this;
            if(baseEl)baseEl.oninput=function(){self.updateTimeoutPreview()};
            if(charEl)charEl.oninput=function(){self.updateTimeoutPreview()};
        },
        saveExamSettings:function(){
            var settings=App.Storage.getSettings();
            settings.shuffleOptions=document.getElementById('exam-shuffle-options').checked;
            settings.absenceCompensation=document.getElementById('exam-absence-compensation').checked;
            settings.baseTimeout=parseFloat(document.getElementById('exam-base-timeout').value)||0;
            settings.charTimeoutCompensation=parseFloat(document.getElementById('exam-char-timeout').value)||0;
            settings.autoNext=document.getElementById('exam-auto-next').checked;
            settings.autoNextDelay=parseFloat(document.getElementById('exam-auto-next-delay').value)||3;
            settings.drawAnimation=document.getElementById('exam-draw-animation').checked;
            settings.drawDuration=parseFloat(document.getElementById('exam-draw-duration').value)||3;
            settings.questionFontSize=parseInt(document.getElementById('exam-question-fontsize').value)||30;
            settings.studentNameFontSize=parseInt(document.getElementById('exam-student-name-fontsize').value)||35;
            settings.studentInfoFontSize=parseInt(document.getElementById('exam-student-info-fontsize').value)||24;
            settings.warReportFontSize=parseInt(document.getElementById('exam-warreport-fontsize').value)||12;
            App.Storage.setSettings(settings);
            App.Toast.show('挑战参数已保存','success');
        },
        updateTimeoutPreview:function(){
            var base=parseFloat(document.getElementById('exam-base-timeout').value)||0;
            var charComp=parseFloat(document.getElementById('exam-char-timeout').value)||0;
            var previewEl=document.getElementById('exam-timeout-preview');
            if(!previewEl)return;
            var examples=[
                {label:'短题（10字）',chars:10},
                {label:'中题（30字）',chars:30},
                {label:'长题（60字）',chars:60},
                {label:'超长题（100字）',chars:100}
            ];
            var html='';
            examples.forEach(function(ex){
                var total=base+ex.chars*charComp;
                html+='<div class="timeout-example"><span class="te-label">'+ex.label+'</span><span class="te-calc">'+base+' + '+ex.chars+'×'+charComp+' = <strong>'+total.toFixed(1)+'秒</strong></span></div>';
            });
            previewEl.innerHTML=html;
        },
        saveAISettings:function(){
            var settings=App.Storage.getSettings();
            settings.aiApiUrl=document.getElementById('ai-api-url').value.trim();
            settings.aiApiKey=document.getElementById('ai-api-key').value.trim();
            settings.aiModel=document.getElementById('ai-model').value.trim();
            App.Storage.setSettings(settings);
            App.Toast.show('AI设置已保存','success');
        },
        loadSoundSettings:function(){
            var settings=App.Storage.getSettings();
            var enabledEl=document.getElementById('sound-enabled');
            var volEl=document.getElementById('sound-volume');
            if(enabledEl)enabledEl.checked=settings.soundEnabled!==false;
            if(volEl)volEl.value=settings.soundVolume||70;
        },
        saveSoundSettings:function(){
            var settings=App.Storage.getSettings();
            settings.soundEnabled=document.getElementById('sound-enabled').checked;
            settings.soundVolume=parseInt(document.getElementById('sound-volume').value)||70;
            App.Storage.setSettings(settings);
            App.Effects.soundEnabled=settings.soundEnabled;
            App.Effects.volume=settings.soundVolume/100;
            App.Effects.updateSoundToggle();
            App.Toast.show('音效设置已保存','success');
        },
        loadSyncSettings:function(){
            this.updateSyncStatus();
        },
        saveSyncSettings:function(){
            App.Toast.show('同步设置请在文件管理器中修改','info');
        },
        syncNow:function(){
            var btn=document.getElementById('btn-sync-now');
            if(btn){btn.disabled=true;btn.textContent='⏳ 同步中...'}
            App.Sync.syncNow();
        },
        updateSyncStatus:function(){
            var el=document.getElementById('sync-status-info');
            if(!el)return;
            var lastTime=parseInt(localStorage.getItem('exam_last_sync_time')||'0');
            var statusText='未同步';
            if(lastTime>0){
                var d=new Date(lastTime);
                statusText='上次同步：'+d.toLocaleString('zh-CN');
            }
            el.textContent=statusText;
        },
        exportDataType:function(type){
            var data,label;
            if(type==='students'){data=App.Storage.getStudents();label='学生信息'}
            else if(type==='banks'){data=App.Storage.getBanks();label='题库文件'}
            else if(type==='records'){data=App.Storage.getRecords();label='考试数据'}
            else return;
            var blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
            var url=URL.createObjectURL(blob);
            var a=document.createElement('a');
            a.href=url;a.download=label+'_'+new Date().toISOString().slice(0,10)+'.json';
            a.click();URL.revokeObjectURL(url);
            App.Toast.show(label+'已导出','success');
        },
        importDataType:function(type){
            var label=type==='students'?'学生信息':type==='banks'?'题库文件':'考试数据';
            var body='<div class="form-group"><label>选择 '+label+' 备份文件</label><input type="file" id="inp-import-dtype-file" accept=".json"></div>';
            body+='<div style="color:var(--warning);font-size:13px;margin-top:8px">⚠️ 导入将强制覆盖本地及云端'+label+'，此操作不可恢复！</div>';
            var footer='<button class="btn-secondary" onclick="App.Modal.close()">取消</button><button class="btn-primary" onclick="App.Settings.doImportDataType(\''+type+'\')">确认导入</button>';
            App.Modal.open('📥 导入'+label,body,footer);
        },
        doImportDataType:function(type){
            var fileInput=document.getElementById('inp-import-dtype-file');
            if(!fileInput||!fileInput.files||!fileInput.files[0]){App.Toast.show('请选择文件','warning');return}
            var label=type==='students'?'学生信息':type==='banks'?'题库文件':'考试数据';
            var reader=new FileReader();
            reader.onload=function(e){
                try{
                    var data=JSON.parse(e.target.result);
                    if(!Array.isArray(data)){App.Toast.show('文件格式错误：需要JSON数组','error');return}
                    if(type==='students'){App.Storage.setStudents(data);App.Students.render()}
                    else if(type==='banks'){App.Storage.setBanks(data);App.Questions.render()}
                    else if(type==='records'){App.Storage.setRecords(data);App.Records.render();App.Leaderboard.render();App.Students.render()}
                    App.Modal.close();
                    App.Settings.updateIOCounts();
                    App.Toast.show(label+'导入成功，已覆盖本地及云端','success');
                }catch(err){
                    App.Toast.show('导入失败：文件格式错误','error');
                }
            };
            reader.readAsText(fileInput.files[0]);
        },
        updateIOCounts:function(){
            var students=App.Storage.getStudents();
            var banks=App.Storage.getBanks();
            var records=App.Storage.getRecords();
            var el1=document.getElementById('io-count-students');
            var el2=document.getElementById('io-count-banks');
            var el3=document.getElementById('io-count-records');
            if(el1)el1.textContent=students.length+'人';
            if(el2)el2.textContent=banks.length+'个题库';
            if(el3)el3.textContent=records.length+'场';
        },
        clearRecords:function(){
            if(!confirm('⚠️ 确定要清空所有场次数据吗？此操作不可恢复！'))return;
            App.Storage.setRecords([]);
            App.Records.render();
            App.Leaderboard.render();
            // 清空云端场次数据文件（整行删除）
            var prefix='exam';
            var fileIndex=JSON.parse(localStorage.getItem(prefix+'_file_index')||'[]');
            var recordsFile=fileIndex.find(function(f){return f.name==='系统-考试数据'});
            if(recordsFile&&recordsFile.id){
                App.Sync.postToFileManager({type:'fileDeleted_local',fileId:recordsFile.id});
            }
            App.Toast.show('场次数据已清空','info');
        },
        resetData:function(){
            if(!confirm('⚠️ 确定要重置所有数据吗？此操作不可恢复！'))return;
            if(!confirm('再次确认：所有学生、题库、记录将被删除！云端数据也将一并删除！'))return;
            // 先删除云端所有文件（整行删除），再清空本地
            var prefix='exam';
            var fileIndex=JSON.parse(localStorage.getItem(prefix+'_file_index')||'[]');
            fileIndex.forEach(function(f){
                if(f.id){
                    App.Sync.postToFileManager({type:'fileDeleted_local',fileId:f.id});
                }
            });
            // 清空本地数据
            var keys=Object.keys(localStorage);
            keys.forEach(function(k){if(k.indexOf('exam_')===0&&k.indexOf('exam_file_')!==0&&k.indexOf('exam_sync_config')!==0&&k.indexOf('exam_last_sync')!==0&&k.indexOf('exam_device_id')!==0&&k.indexOf('exam_auth_')!==0)localStorage.removeItem(k)});
            // 同时清空文件索引和文件数据
            keys.forEach(function(k){if(k.indexOf('exam_file_')===0)localStorage.removeItem(k)});
            App.Storage.ensureDefaults();
            App.Students.render();
            App.Questions.render();
            App.Leaderboard.render();
            App.Records.render();
            this.renderLevels();
            App.Toast.show('数据已重置，云端数据正在删除中','info');
        },
        StudentMgmt:{
            _dirty:false,
            _markDirty:function(){
                this._dirty=true;
                var btn=document.getElementById('btn-save-students');
                if(btn)btn.style.display='inline-flex';
            },
            _clearDirty:function(){
                this._dirty=false;
                var btn=document.getElementById('btn-save-students');
                if(btn)btn.style.display='none';
            },
            render:function(){
                var students=App.Storage.getStudents();
                var wrap=document.getElementById('student-mgmt-wrap');
                var empty=document.getElementById('student-mgmt-empty');
                if(students.length===0){wrap.innerHTML='';empty.classList.add('show');this._clearDirty();return}
                empty.classList.remove('show');
                var groups=App.Storage.getGroups();
                var groupOptions='';
                var avMap=buildAvatarCharMap(students);
                groups.forEach(function(g){groupOptions+='<option value="'+g+'">'});
                var html='<table class="student-table editable"><thead><tr>';
                html+='<th>头像</th><th>姓名</th><th>性别</th><th>小组</th><th>操作</th>';
                html+='</tr></thead><tbody>';
                students.forEach(function(s){
                    html+='<tr data-id="'+s.id+'">';
                    html+='<td><div class="st-avatar-cell" onclick="App.Settings.StudentMgmt.triggerAvatarUpload(\''+s.id+'\')" title="点击更换头像">'+(s.avatar?'<img src="'+s.avatar+'">':(avMap[s.id]||s.name.charAt(0)))+'<input type="file" class="hidden-avatar-input" data-id="'+s.id+'" accept="image/*" onchange="App.Settings.StudentMgmt.onAvatarChange(this)"></div></td>';
                    html+='<td><input type="text" class="inline-input inline-name" data-id="'+s.id+'" data-field="name" value="'+s.name.replace(/"/g,'&quot;')+'" onchange="App.Settings.StudentMgmt._markDirty()"></td>';
                    html+='<td><select class="inline-select inline-gender" data-id="'+s.id+'" data-field="gender" onchange="App.Settings.StudentMgmt._markDirty()"><option value=""'+(s.gender===''?' selected':'')+'>-</option><option value="男"'+(s.gender==='男'?' selected':'')+'>男</option><option value="女"'+(s.gender==='女'?' selected':'')+'>女</option></select></td>';
                    html+='<td><input type="text" class="inline-input inline-group" data-id="'+s.id+'" data-field="group" value="'+(s.group||'').replace(/"/g,'&quot;')+'" list="group-dl-'+s.id+'" onchange="App.Settings.StudentMgmt._markDirty()"><datalist id="group-dl-'+s.id+'">'+groupOptions+'</datalist></td>';
                    html+='<td class="st-actions"><button class="btn-table btn-table-del" onclick="App.Settings.StudentMgmt.remove(\''+s.id+'\')" title="删除">🗑️</button></td>';
                    html+='</tr>';
                });
                html+='</tbody></table>';
                wrap.innerHTML=html;
                this._clearDirty();
            },
            triggerAvatarUpload:function(id){
                var inp=document.querySelector('#stab-students .hidden-avatar-input[data-id="'+id+'"]');
                if(inp)inp.click();
            },
            onAvatarChange:function(input){
                if(!input.files||!input.files[0])return;
                var id=input.dataset.id;
                var reader=new FileReader();
                reader.onload=function(e){
                    var cell=input.closest('.st-avatar-cell');
                    var img=cell.querySelector('img');
                    if(img){img.src=e.target.result}
                    else{cell.innerHTML='<img src="'+e.target.result+'"><input type="file" class="hidden-avatar-input" data-id="'+id+'" accept="image/*" onchange="App.Settings.StudentMgmt.onAvatarChange(this)">'};
                    cell._newAvatar=e.target.result;
                    App.Settings.StudentMgmt._markDirty();
                };
                reader.readAsDataURL(input.files[0]);
            },
            saveAll:function(){
                var students=App.Storage.getStudents();
                var hasError=false;
                document.querySelectorAll('#stab-students .inline-name').forEach(function(inp){
                    var val=inp.value.trim();
                    if(!val){hasError=true;inp.classList.add('input-error');return}
                    inp.classList.remove('input-error');
                    var s=students.find(function(x){return x.id===inp.dataset.id});
                    if(s)s.name=val;
                });
                if(hasError){App.Toast.show('姓名不能为空','warning');return}
                document.querySelectorAll('#stab-students .inline-gender').forEach(function(sel){
                    var s=students.find(function(x){return x.id===sel.dataset.id});
                    if(s)s.gender=sel.value;
                });
                document.querySelectorAll('#stab-students .inline-group').forEach(function(inp){
                    var s=students.find(function(x){return x.id===inp.dataset.id});
                    if(s)s.group=inp.value.trim();
                });
                document.querySelectorAll('#stab-students .st-avatar-cell').forEach(function(cell){
                    if(cell._newAvatar){
                        var inp=cell.querySelector('.hidden-avatar-input');
                        if(inp){
                            var sid=inp.dataset.id;
                            var s=students.find(function(x){return x.id===sid});
                            if(s)s.avatar=cell._newAvatar;
                        }
                    }
                });
                App.Storage.setStudents(students);
                this.render();
                App.Students.render();
                App.Leaderboard.render();
                App.Toast.show('学生信息已保存','success');
                App.Effects.playClick();
            },
            addRow:function(){
                var students=App.Storage.getStudents();
                var newStudent={id:genId(),name:'新学生',avatar:'',gender:'',group:'',createdAt:Date.now()};
                students.push(newStudent);
                App.Storage.setStudents(students);
                this.render();
                var nameInput=document.querySelector('#stab-students .inline-name[data-id="'+newStudent.id+'"]');
                if(nameInput){nameInput.focus();nameInput.select()}
                this._markDirty();
                App.Toast.show('已添加新学生，请修改信息后保存','info');
            },
            remove:function(id){
                if(!confirm('确定要删除该学生吗？'))return;
                var students=App.Storage.getStudents().filter(function(x){return x.id!==id});
                App.Storage.setStudents(students);
                this.render();
                App.Students.render();
                App.Leaderboard.render();
                App.Toast.show('学生已删除','info');
            },
            clearAll:function(){
                if(!confirm('确定要清空所有学生吗？此操作不可恢复！'))return;
                App.Storage.setStudents([]);
                this.render();
                App.Students.render();
                App.Leaderboard.render();
                // 清空云端学生信息文件（整行删除）
                var prefix='exam';
                var fileIndex=JSON.parse(localStorage.getItem(prefix+'_file_index')||'[]');
                var studentFile=fileIndex.find(function(f){return f.name==='系统-学生信息'});
                if(studentFile&&studentFile.id){
                    App.Sync.postToFileManager({type:'fileDeleted_local',fileId:studentFile.id});
                }
                App.Toast.show('所有学生已清空','info');
            },
            showImportDialog:function(){
                var body='<div class="import-format-hint">批量导入格式说明：每行一个学生姓名<br>也可使用格式：<code>姓名,性别,小组</code><br>示例：<br><code>张三,男,第一组</code><br><code>李四,女,第二组</code></div>';
                body+='<div class="form-group"><label>粘贴学生列表</label><textarea id="inp-import-students" placeholder="每行一个学生姓名" rows="8"></textarea></div>';
                body+='<div class="form-group"><label>或从TXT文件导入</label><input type="file" id="inp-import-file" accept=".txt"></div>';
                var footer='<button class="btn-secondary" onclick="App.Modal.close()">取消</button><button class="btn-primary" onclick="App.Settings.StudentMgmt.doImport()">导入</button>';
                App.Modal.open('批量导入学生',body,footer);
            },
            doImport:function(){
                var ta=document.getElementById('inp-import-students');var fi=document.getElementById('inp-import-file');var text=ta.value.trim();
                if(fi.files&&fi.files[0]){var reader=new FileReader();reader.onload=function(e){App.Settings.StudentMgmt.processImport(e.target.result)};reader.readAsText(fi.files[0]);return}
                if(!text){App.Toast.show('请输入学生数据或选择文件','warning');return}
                this.processImport(text);
            },
            processImport:function(text){
                var lines=text.split('\n'),students=App.Storage.getStudents(),count=0;
                lines.forEach(function(line){line=line.trim();if(!line)return;var parts=line.split(','),name=parts[0].trim(),gender=parts[1]?parts[1].trim():'',group=parts[2]?parts[2].trim():'';if(name){var exists=students.some(function(s){return s.name===name});if(!exists){students.push({id:genId(),name:name,avatar:'',gender:gender,group:group,createdAt:Date.now()});count++}}});
                App.Storage.setStudents(students);App.Modal.close();this.render();App.Students.render();App.Toast.show('成功导入 '+count+' 名学生','success');
            }
        }
    };

    App.switchView = function(view){
        document.querySelectorAll('.view').forEach(function(v){v.classList.remove('active')});
        document.querySelectorAll('.nav-btn').forEach(function(b){b.classList.remove('active')});
        var viewEl=document.getElementById('view-'+view);
        var navBtn=document.querySelector('.nav-btn[data-view="'+view+'"]');
        if(viewEl)viewEl.classList.add('active');
        if(navBtn)navBtn.classList.add('active');
        if(view==='students')App.Students.render();
        if(view==='questions')App.Questions.render();
        if(view==='leaderboard'){if(App.Exam._showingRound){App.Exam._showingRound=false}else{App.Leaderboard.render()}}
        if(view==='settings'){App.Settings.renderLevels();App.Settings.loadSoundSettings();App.Settings.loadAISettings();App.Settings.loadExamSettings()}
        if(view==='home'){
            if(App.Exam.currentExam){
                document.getElementById('exam-mode-select').classList.add('hidden');
                document.getElementById('exam-setup').classList.add('hidden');
                var drawing=document.getElementById('exam-drawing');
                var playing=document.getElementById('exam-playing');
                if(!drawing.classList.contains('hidden')||!playing.classList.contains('hidden')){
                }else{
                    document.getElementById('exam-playing').classList.remove('hidden');
                }
                var sidebar=document.getElementById('exam-play-sidebar');
                if(sidebar)sidebar.classList.remove('hidden');
            }else{
                var resumed=App.Exam.checkResumableExam();
                if(!resumed){
                    document.getElementById('exam-mode-select').classList.remove('hidden');
                    document.getElementById('exam-setup').classList.add('hidden');
                    document.getElementById('exam-drawing').classList.add('hidden');
                    document.getElementById('exam-playing').classList.add('hidden');
                    var sidebar=document.getElementById('exam-play-sidebar');
                    if(sidebar)sidebar.classList.add('hidden');
                    var hc=document.querySelector('.home-container');if(hc)hc.classList.remove('in-exam');
                }
            }
        }
    };

    App.toggleFullscreen = function(){
        if(!document.fullscreenElement){
            document.documentElement.requestFullscreen().catch(function(){});
        }else{
            document.exitFullscreen().catch(function(){});
        }
    };

    App._zoomLevel=100;
    App.zoomIn=function(){
        if(App._zoomLevel>=200)return;
        App._zoomLevel+=10;
        App._applyZoom();
    };
    App.zoomOut=function(){
        if(App._zoomLevel<=50)return;
        App._zoomLevel-=10;
        App._applyZoom();
    };
    App._applyZoom=function(){
        document.body.style.zoom=App._zoomLevel/100;
        var el=document.getElementById('zoom-level');
        if(el)el.textContent=App._zoomLevel+'%';
        try{localStorage.setItem('exam_zoom',App._zoomLevel)}catch(e){}
    };
    (function(){
        var saved=parseInt(localStorage.getItem('exam_zoom'));
        if(saved>=50&&saved<=200){App._zoomLevel=saved;App._applyZoom()}
    })();

    App.Sync = {
        frame:null,
        ready:false,
        _isFileManagerOpen:false,
        _currentFileName:'',
        _pulling:false,
        init:function(){
            this.frame=document.getElementById('fileManagerBg');
            if(!this.frame)return;
            var self=this;
            this._attachFrameReady(this.frame);
            this._attachFrameReady(document.getElementById('fileManagerFrame'));
            window.addEventListener('message',function(e){
                if(!e.data||typeof e.data!=='object')return;
                var msg=e.data;
                if(!msg.type)return;
                switch(msg.type){
                    case 'openFile':
                        self._onOpenFile(msg);
                        break;
                    case 'fileContentUpdated':
                        self._onFileContentUpdated(msg);
                        break;
                    case 'fileDeleted':
                        self._onFileDeleted(msg);
                        break;
                    case 'fileRenamed':
                        self._onFileRenamed(msg);
                        break;
                    case 'closeFileManager':
                        self._isFileManagerOpen=false;
                        var modal=document.getElementById('file-modal');
                        if(modal)modal.style.display='none';
                        break;
                    case 'syncStatusChanged':
                        var btn=document.getElementById('btn-sync-now');
                        if(btn){
                            if(msg.icon==='🔄'||msg.icon==='⏳'){btn.disabled=true;btn.textContent='⏳ 同步中...'}
                            else{btn.disabled=false;btn.textContent='☁️ 立即同步'}
                        }
                        if(App.Settings&&App.Settings.updateSyncStatus)App.Settings.updateSyncStatus();
                        break;
                    case 'syncToast':
                        if(!self._isFileManagerOpen)App.Toast.show(msg.message||'','info');
                        break;
                    case 'registerResult':
                        console.log('[Sync] 注册结果:',msg.success,msg.name,msg.id);
                        break;
                    case 'importResult':
                        console.log('[Sync] 导入结果:',msg.success,msg.name,msg.id);
                        break;
                    case 'syncComplete':
                        if(App.Settings&&App.Settings.updateSyncStatus)App.Settings.updateSyncStatus();
                        if(!self._pulling)self.pullAllCloudContent();
                        if(App.Questions)App.Questions.render();
                        break;
                    case 'bankIdMigrated':
                        // 文件管理器通知题库ID从旧格式迁移到QB_格式
                        if(msg.oldId&&msg.newId){
                            var banks=App.Storage.getBanks();
                            var bank=banks.find(function(b){return b.id===msg.oldId});
                            if(bank){
                                bank.id=msg.newId;
                                App.Storage.setBanks(banks);
                                console.log('[Sync] 题库ID迁移: '+msg.oldId+' → '+msg.newId+' ('+msg.name+')');
                            }
                        }
                        break;
                    case 'cloudIndexUpdated':
                        // 云端索引更新完成，刷新题库列表
                        if(App.Questions)App.Questions.render();
                        break;
                }
            });
            document.addEventListener('visibilitychange',function(){
                if(!document.hidden&&self.ready){
                    self.postToFileManager({type:'mainActivated'});
                    self._ensureCoreStars();
                }
            });
            setTimeout(function(){
                self.migrateOldData();
                self.postToFileManager({type:'initConfig',appPrefix:'exam'});
                self.postToFileManager({type:'mainReady'});
                self.ready=true;
                self._ensureCoreStars();
                self.syncAll();
                setTimeout(function(){self.pullAllCloudContent()},8000);
            },1500);
        },
        getFrame:function(){
            if(this._isFileManagerOpen)return document.getElementById('fileManagerFrame');
            return document.getElementById('fileManagerBg');
        },
        postToFileManager:function(msg){
            var frame=this.getFrame();
            if(frame&&frame.contentWindow){
                try{frame.contentWindow.postMessage(Object.assign({target:'fileManager'},msg),'*')}catch(e){}
            }
        },
        _frameReady:false,
        _pending:null,
        _attachFrameReady:function(frame){
            if(!frame)return;
            var self=this;
            var mark=function(){
                try{if(frame.contentDocument&&frame.contentDocument.readyState!=='complete')return}catch(e){}
                self._frameReady=true;
                self._flushPending();
            };
            try{frame.addEventListener('load',mark)}catch(e){}
            mark();
        },
        _pushContent:function(name,content){
            if(!name||content===undefined)return;
            if(!this._frameReady){this._pending=this._pending||[];this._pending.push({name:name,content:content});return}
            this.postToFileManager({type:'contentChanged',name:name,content:content});
        },
        _flushPending:function(){
            if(!this._pending||!this._pending.length)return;
            var q=this._pending;this._pending=[];
            for(var i=0;i<q.length;i++)this.postToFileManager({type:'contentChanged',name:q[i].name,content:q[i].content});
        },
        _ensureCoreStars:function(){
            try{
                var prefix='exam';
                var idx=JSON.parse(localStorage.getItem(prefix+'_file_index')||'[]');
                var names=['系统-学生信息','系统-考试数据','系统-等级设置','系统-AI配置'];
                var changed=false;
                for(var i=0;i<idx.length;i++){if(names.indexOf(idx[i].name)>=0&&!idx[i].star){idx[i].star=true;changed=true}}
                if(changed){localStorage.setItem(prefix+'_file_index',JSON.stringify(idx));}
                for(var j=0;j<idx.length;j++){if(names.indexOf(idx[j].name)>=0&&idx[j].id)this.postToFileManager({type:'setStar',id:idx[j].id,star:true});}
            }catch(e){}
        },
        _formatTime:function(){
            var d=new Date();
            var offset=d.getTimezoneOffset();
            var bjTime=new Date(d.getTime()-offset*60000+8*3600000);
            var pad=function(n){return String(n).padStart(2,'0')};
            return bjTime.getFullYear()+'-'+pad(bjTime.getMonth()+1)+'-'+pad(bjTime.getDate())+' '+pad(bjTime.getHours())+':'+pad(bjTime.getMinutes())+':'+pad(bjTime.getSeconds());
        },
        _getFileNameForDataType:function(dataType,bankName){
            if(dataType==='students')return '系统-学生信息';
            if(dataType==='records')return '系统-考试数据';
            if(dataType==='levels')return '系统-等级设置';
            if(dataType==='aiConfig')return '系统-AI配置';
            if(dataType==='bank'&&bankName)return bankName;
            return null;
        },
        _getDataTypeForFileName:function(fileName){
            if(fileName==='系统-学生信息')return 'students';
            if(fileName==='系统-考试数据')return 'records';
            if(fileName==='系统-等级设置')return 'levels';
            if(fileName==='系统-AI配置')return 'aiConfig';
            if(fileName!=='')return 'bank';
            return null;
        },
        _getContentForDataType:function(dataType){
            if(dataType==='students')return JSON.stringify(App.Storage.getStudents());
            if(dataType==='records')return JSON.stringify(App.Storage.getRecords());
            if(dataType==='levels')return JSON.stringify(App.Storage.getSettings().levels||[]);
            if(dataType==='aiConfig')return JSON.stringify({aiApiUrl:App.Storage.getSettings().aiApiUrl||'',aiApiKey:App.Storage.getSettings().aiApiKey||'',aiModel:App.Storage.getSettings().aiModel||''});
            return null;
        },
        _getFileIdForDataType:function(dataType){
            if(dataType==='students')return 'EXAM_SYS_STUDENT_INFO';
            if(dataType==='records')return 'EXAM_SYS_RECORDS';
            if(dataType==='levels')return 'EXAM_SYS_LEVELS';
            if(dataType==='aiConfig')return 'EXAM_SYS_AI_CONFIG';
            return null;
        },
        _applyContentToApp:function(dataType,content){
            try{
                var data=JSON.parse(content);
                App.Storage._syncSilent=true;
                try{
                    if(dataType==='students'){
                        App.Storage.set('students',data);
                        App.Students.render();
                        if(App.Settings&&App.Settings.StudentMgmt&&App.Settings.StudentMgmt.render)App.Settings.StudentMgmt.render();
                    }else if(dataType==='records'){
                        App.Storage.set('records',data);
                        if(App.Settings&&App.Settings.renderRecords)App.Settings.renderRecords();
                    }else if(dataType==='levels'){
                        var curSettings=App.Storage.getSettings();
                        curSettings.levels=data;
                        App.Storage.set('settings',curSettings);
                        if(App.Settings&&App.Settings.renderLevels)App.Settings.renderLevels();
                    }else if(dataType==='aiConfig'){
                        var curSettings2=App.Storage.getSettings();
                        curSettings2.aiApiUrl=data.aiApiUrl||'';
                        curSettings2.aiApiKey=data.aiApiKey||'';
                        curSettings2.aiModel=data.aiModel||'';
                        App.Storage.set('settings',curSettings2);
                        if(App.Settings&&App.Settings.loadAISettings)App.Settings.loadAISettings();
                    }else if(dataType==='bank'){
                        if(data&&data.id){
                            var existingBanks=App.Storage.getBanks();
                            var bankId=data.id;
                            var idx=existingBanks.findIndex(function(b){return b.id===bankId});
                            if(idx>=0){
                                existingBanks[idx]=data;
                            }else{
                                // ID不匹配时，按名称查找同名空题库并替换
                                var nameIdx=existingBanks.findIndex(function(b){return b.name===data.name&&(!b.questions||b.questions.length===0)});
                                if(nameIdx>=0){
                                    existingBanks[nameIdx]=data;
                                }else{
                                    existingBanks.push(data);
                                }
                            }
                            App.Storage.set('banks',existingBanks);
                            App.Questions.render();
                        }
                    }
                }finally{
                    App.Storage._syncSilent=false;
                }
            }catch(e){console.error('[Sync] 应用内容失败:',e)}
        },
        _onOpenFile:function(msg){
            if(!msg.name)return;
            var dataType=this._getDataTypeForFileName(msg.name);
            if(dataType&&msg.content!==undefined){
                this._applyContentToApp(dataType,msg.content);
            }
        },
        _onFileContentUpdated:function(msg){
            if(!msg.name)return;
            var dataType=this._getDataTypeForFileName(msg.name);
            if(dataType&&msg.content!==undefined){
                this._applyContentToApp(dataType,msg.content);
            }
        },
        _onFileDeleted:function(msg){
            if(!msg.name)return;
            var dataType=this._getDataTypeForFileName(msg.name);
            if(dataType==='bank'){
                var bankId=msg.name.replace('题库-','');
                var banks=App.Storage.getBanks().filter(function(b){return b.id!==bankId&&b.name!==bankId});
                App.Storage._syncSilent=true;
                try{App.Storage.set('banks',banks);App.Questions.render()}finally{App.Storage._syncSilent=false}
            }
        },
        _onFileRenamed:function(msg){
            // 文件重命名暂不处理
        },
        notifyChange:function(dataType,data){
            if(!this.ready)return;
            var isLoggedIn=App.Login&&App.Login.isLoggedIn();
            var prefix='exam';
            if(dataType==='banks'){
                var banks=App.Storage.getBanks();
                var fileIndex=JSON.parse(localStorage.getItem(prefix+'_file_index')||'[]');
                var self=this;
                var banksChanged=false;
                // 跳过demo题库，不创建文件索引也不上传
                banks.forEach(function(b){
                    if(b._demo)return;
                    var bankId=b.id||b.name;
                    // 兼容旧数据：如果题库ID不是QB_前缀，分配新的QB_ ID
                    if(!bankId.startsWith('QB_')){
                        // 先检查文件索引中是否有同名文件已有QB_ ID（云端已存在的）
                        var sameNameEntry=fileIndex.find(function(x){return x.name===b.name&&x.id&&x.id.startsWith('QB_')});
                        if(sameNameEntry){
                            // 复用云端已有的QB_ ID
                            b.id=sameNameEntry.id;
                            bankId=sameNameEntry.id;
                            banksChanged=true;
                        }else{
                            var newId=genBankId();
                            // 检查文件索引中是否已有该旧ID的记录，需要迁移
                            var oldEntry=fileIndex.find(function(x){return x.id===bankId});
                            if(oldEntry){
                                // 迁移旧ID到新QB_ ID
                                var oldData=localStorage.getItem(prefix+'_file_id_'+bankId);
                                if(oldData){
                                    localStorage.setItem(prefix+'_file_id_'+newId,oldData);
                                    localStorage.removeItem(prefix+'_file_id_'+bankId);
                                }
                                oldEntry.id=newId;
                            }
                            b.id=newId;
                            bankId=newId;
                            banksChanged=true;
                        }
                    }
                    var fileName=b.name||bankId;
                    var content=JSON.stringify(b);
                    var existing=fileIndex.find(function(x){return x.id===bankId});
                    // 如果ID不匹配，再检查是否有同名文件（云端已有同名题库）
                    if(!existing){
                        existing=fileIndex.find(function(x){return x.name===fileName&&x.id!==bankId});
                        if(existing){
                            // 复用已有文件索引的ID，避免同名不同ID导致重复
                            var oldBankData=localStorage.getItem(prefix+'_file_id_'+bankId);
                            if(oldBankData){
                                localStorage.setItem(prefix+'_file_id_'+existing.id,oldBankData);
                                localStorage.removeItem(prefix+'_file_id_'+bankId);
                            }
                            b.id=existing.id;
                            bankId=existing.id;
                            banksChanged=true;
                        }
                    }
                    if(existing){
                        // 比较内容是否真正变化，只有变化时才增加版本号
                        var oldData=null;
                        try{var raw=localStorage.getItem(prefix+'_file_id_'+existing.id);if(raw)oldData=JSON.parse(raw).data}catch(e){}
                        var contentChanged=!oldData||oldData!==content;
                        if(contentChanged){existing.version=(existing.version||0)+1}
                        existing.contentLength=[...content].length;
                        existing.lastEditTime=App.Sync._formatTime();
                        // 题库文件不设置文件夹（云端平铺）
                        self._pushContent(fileName,content);
                    }else{
                        fileIndex.push({name:fileName,id:bankId,version:1,lastSyncVersion:0,isNewFile:true,folder:'',owner:'',createTime:'',lastUploadTime:'',lastEditTime:App.Sync._formatTime(),contentLength:[...content].length,time:Date.now()});
                        self._pushContent(fileName,content);
                    }
                });
                if(banksChanged)App.Storage.setBanks(banks);
                try{localStorage.setItem(prefix+'_file_index',JSON.stringify(fileIndex))}catch(e){}
                if(isLoggedIn)this.postToFileManager({type:'syncAllFiles'});
            }else{
                var fileName=this._getFileNameForDataType(dataType);
                var content=this._getContentForDataType(dataType);
                // 如果学生全是demo数据，不上传系统-学生信息文件
                if(dataType==='students'&&content){
                    try{var parsed=JSON.parse(content);if(Array.isArray(parsed)&&parsed.every(function(s){return s._demo})){content=null}}catch(e){}
                }
                if(fileName&&content){
                    var fileIndex2=JSON.parse(localStorage.getItem(prefix+'_file_index')||'[]');
                    var existing2=fileIndex2.find(function(x){return x.name===fileName});
                    if(existing2){
                        var oldData2=null;
                        try{var raw2=localStorage.getItem(prefix+'_file_id_'+existing2.id);if(raw2)oldData2=JSON.parse(raw2).data}catch(e){}
                        var contentChanged2=!oldData2||oldData2!==content;
                        if(contentChanged2){existing2.version=(existing2.version||0)+1}
                        existing2.contentLength=[...content].length;
                        existing2.lastEditTime=this._formatTime();
                        existing2.star=true;
                        try{localStorage.setItem(prefix+'_file_id_'+existing2.id,JSON.stringify({data:content,view:null}))}catch(e){}
                        this._pushContent(fileName,content);
                    }else{
                        var id=this._getFileIdForDataType(dataType);
                        fileIndex2.push({name:fileName,id:id,version:1,lastSyncVersion:0,isNewFile:true,folder:'系统',owner:'',createTime:'',lastUploadTime:'',lastEditTime:this._formatTime(),contentLength:[...content].length,time:Date.now(),star:true});
                        try{localStorage.setItem(prefix+'_file_id_'+id,JSON.stringify({data:content,view:null}))}catch(e){}
                        this._pushContent(fileName,content);
                    }
                    try{localStorage.setItem(prefix+'_file_index',JSON.stringify(fileIndex2))}catch(e){}
                    if(isLoggedIn)this.postToFileManager({type:'syncAllFiles'});
                }
            }
        },
        syncNow:function(){
            if(App.Login && !App.Login.isLoggedIn()){
                App.Toast.show('请先登录后再同步','warning');
                App.Login.openModal();
                return;
            }
            this.postToFileManager({type:'syncAllFiles'});
        },
        syncAll:function(){
            if(App.Login && !App.Login.isLoggedIn()){
                App.Toast.show('请先登录后再同步','warning');
                App.Login.openModal();
                return;
            }
            this.postToFileManager({type:'syncAllFiles'});
        },
        updateConfig:function(config){
            this.postToFileManager({type:'initConfig',config:config});
        },
        deleteBank:function(bankKey){
            var banks=App.Storage.getBanks();
            var bank=banks.find(function(b){return b.id===bankKey||b.name===bankKey});
            var fileName=bank?bank.name:bankKey;
            var fileId=bank?bank.id:bankKey;
            this.postToFileManager({type:'fileDeleted_local',fileId:fileId});
        },
        openFileManager:function(){
            this._isFileManagerOpen=true;
            var modal=document.getElementById('file-modal');
            if(modal)modal.style.display='flex';
            var frame=document.getElementById('fileManagerFrame');
            if(frame&&frame.contentWindow){
                frame.contentWindow.postMessage({target:'fileManager',type:'open'},'*');
            }
        },
        closeFileManager:function(){
            this._isFileManagerOpen=false;
            var modal=document.getElementById('file-modal');
            if(modal)modal.style.display='none';
        },
        pullAllCloudContent:function(){
            var prefix='exam';
            var fileIndex=JSON.parse(localStorage.getItem(prefix+'_file_index')||'[]');
            var self=this;
            // 题库文件不自动下载，只下载系统文件（学生信息、考试数据、等级设置）
            var needPull=fileIndex.filter(function(f){
                if(f.id&&f.id.startsWith('QB_'))return false;  // 题库按需下载，不自动拉取
                return f.cloudOnly||f.contentLength===0||f.isNewFile;
            });
            if(needPull.length===0)return;
            console.log('[Sync] 需要拉取内容的系统文件：'+needPull.length+'个（题库按需下载，不自动拉取）');
            self._pulling=true;
            var i=0;
            function pullNext(){
                if(i>=needPull.length){self._pulling=false;return}
                var f=needPull[i];
                i++;
                self.postToFileManager({type:'downloadCloudFile',fileId:f.id,fileName:f.name});
                setTimeout(pullNext,3000);
            }
            pullNext();
        },
        migrateOldData:function(){
            try{
                var migrated=localStorage.getItem('exam_sync_migrated_v2');
                if(migrated)return;
                // 如果文件索引已存在（由syncAllFiles创建），说明已初始化，跳过
                var existingIndex=localStorage.getItem('exam_file_index');
                if(existingIndex){localStorage.setItem('exam_sync_migrated_v2','1');return}
                var banks=App.Storage.getBanks();
                var students=App.Storage.getStudents();
                var records=App.Storage.getRecords();
                var levels=App.Storage.getSettings().levels||[];
                // 检查是否有非默认的用户数据（有云端ID的题库说明是旧同步数据）
                var hasRealData=banks.some(function(b){return b.id&&b.id.indexOf('QB_')===0})||
                    students.some(function(s){return !s._demo})||
                    Object.keys(records).length>0;
                if(!hasRealData){
                    localStorage.setItem('exam_sync_migrated_v2','1');
                    console.log('[Sync] 无旧同步数据，跳过迁移，等待云端拉取');
                    return;
                }
                var fileIndex=[];
                var prefix='exam';
                banks.forEach(function(b){
                    var id=b.id||('QB_'+Math.floor(1000000000+Math.random()*9000000000));
                    var name=b.name||id;
                    var content=JSON.stringify(b);
                    var fileId=id;
                    fileIndex.push({name:name,id:fileId,version:1,lastSyncVersion:0,isNewFile:true,folder:'',owner:'',createTime:'',lastUploadTime:'',lastEditTime:App.Sync._formatTime(),contentLength:[...content].length});
                    try{localStorage.setItem(prefix+'_file_id_'+fileId,JSON.stringify({data:content,view:null}))}catch(e){}
                });
                var aiConfig={aiApiUrl:App.Storage.getSettings().aiApiUrl||'',aiApiKey:App.Storage.getSettings().aiApiKey||'',aiModel:App.Storage.getSettings().aiModel||''};
                var sysFiles=[
                    {key:'EXAM_SYS_STUDENT_INFO',name:'系统-学生信息',content:JSON.stringify(students),folder:'系统'},
                    {key:'EXAM_SYS_RECORDS',name:'系统-考试数据',content:JSON.stringify(records),folder:'系统'},
                    {key:'EXAM_SYS_LEVELS',name:'系统-等级设置',content:JSON.stringify(levels),folder:'系统'},
                    {key:'EXAM_SYS_AI_CONFIG',name:'系统-AI配置',content:JSON.stringify(aiConfig),folder:'系统'}
                ];
                sysFiles.forEach(function(f){
                    fileIndex.push({name:f.name,id:f.key,version:1,lastSyncVersion:0,isNewFile:true,folder:f.folder,owner:'',createTime:'',lastUploadTime:'',lastEditTime:App.Sync._formatTime(),contentLength:[...f.content].length,star:true});
                    try{localStorage.setItem(prefix+'_file_id_'+f.key,JSON.stringify({data:f.content,view:null}))}catch(e){}
                });
                try{localStorage.setItem(prefix+'_file_index',JSON.stringify(fileIndex))}catch(e){}
                localStorage.setItem('exam_sync_migrated_v2','1');
                console.log('[Sync] 旧数据迁移完成，共'+fileIndex.length+'个文件');
            }catch(e){console.error('[Sync] 迁移失败:',e)}
        }
    };

    // ========== 登录系统模块 ==========
    App.Login = {
        _loggedIn: false,
        _username: '',
        _password: '',
        LOGIN_API_URL: 'https://1408347752-dxgsap4qrj.ap-guangzhou.tencentscf.com',
        LOGIN_WEBHOOK_URL: 'https://www.kdocs.cn/api/v3/ide/file/504393979179/script/V2-jCry7lblkwsPtTSmtjlWY/sync_task',

        init: function(){
            var self = this;
            // 从localStorage恢复登录状态
            var savedUser = localStorage.getItem('exam_auth_user') || '';
            var savedPwd = localStorage.getItem('exam_auth_pass') || '';
            if(savedUser && savedPwd){
                this._loggedIn = true;
                this._username = savedUser;
                this._password = savedPwd;
            }
            this.updateUI();

            // 未登录：清空本地缓存并跳转到登录页
            if(!this._loggedIn){
                this._clearAllCache();
                this._redirectToLogin();
                return;
            }

            // 延迟：验证已有凭据 + 通知文件管理器
            setTimeout(function(){
                self.verifyCredentials(self._username, self._password, function(ok){
                    if(!ok){
                        self._clearAllCache();
                        App.Toast.show('登录已过期，请重新登录', 'warning');
                        self._redirectToLogin();
                    }
                });
                self._notifyFileManager();
            }, 2000);
        },

        // 清空所有 exam_ 开头的本地缓存（保留设备标识）
        _clearAllCache: function(){
            try{
                var keysToRemove = [];
                for(var i = 0; i < localStorage.length; i++){
                    var key = localStorage.key(i);
                    if(key && key.indexOf('exam_') === 0 && key !== 'exam_device_id'){
                        keysToRemove.push(key);
                    }
                }
                keysToRemove.forEach(function(k){ localStorage.removeItem(k); });
            }catch(e){}
            this._loggedIn = false;
            this._username = '';
            this._password = '';
        },

        // 跳转到登录页
        _redirectToLogin: function(){
            window.location.href = 'denglu.html';
        },

        _notifyFileManager: function(){
            var frames = [document.getElementById('fileManagerBg'), document.getElementById('fileManagerFrame')];
            var self = this;
            frames.forEach(function(frame){
                if(frame && frame.contentWindow){
                    try{
                        frame.contentWindow.postMessage({
                            target: 'fileManager',
                            type: 'authChanged',
                            username: self._username,
                            password: self._password
                        }, '*');
                    }catch(e){}
                }
            });
        },

        verifyCredentials: function(username, password, callback){
            var self = this;
            var body = {
                webhookUrl: self.LOGIN_WEBHOOK_URL,
                message: { Context: { argv: { "登录行为":"登录","用户名":username,"密码":password } } }
            };
            fetch(self.LOGIN_API_URL, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(body)
            }).then(function(res){ return res.text(); }).then(function(txt){
                try{
                    var d = JSON.parse(txt);
                    var result = d.data && d.data.result ? d.data.result : d;
                    if(result.TZbianhao === 501){
                        callback(true);
                    } else {
                        callback(false);
                    }
                }catch(e){ callback(false); }
            }).catch(function(e){
                // 网络异常时容许离线使用
                callback(true);
            });
        },

        openModal: function(){
            // 直接跳转到登录页
            this._redirectToLogin();
        },

        closeModal: function(){
            // 同页跳转模式下无需关闭弹窗
        },

        logout: function(){
            if(!confirm('退出登录将清空所有本地缓存数据，确定退出？')) return;
            this._clearAllCache();
            this.updateUI();
            App.Toast.show('已退出登录，本地缓存已清空', 'info');

            // 通知文件管理器登出
            var frames = [document.getElementById('fileManagerBg'), document.getElementById('fileManagerFrame')];
            frames.forEach(function(frame){
                if(frame && frame.contentWindow){
                    try{
                        frame.contentWindow.postMessage({
                            target: 'fileManager',
                            type: 'logout'
                        }, '*');
                    }catch(e){}
                }
            });

            // 延迟跳转登录页，确保 Toast 和 postMessage 能发出
            setTimeout(function(){ window.location.href = 'denglu.html'; }, 800);
        },

        isLoggedIn: function(){
            return this._loggedIn;
        },

        getUsername: function(){
            return this._username;
        },

        getCredentials: function(){
            if(!this._loggedIn) return null;
            return {username: this._username, password: this._password};
        },

        updateUI: function(){
            var display = document.getElementById('login-user-display');
            var btnLogin = document.getElementById('btn-login');
            var btnLogout = document.getElementById('btn-logout');
            if(display){
                if(this._loggedIn){
                    display.textContent = '👤 ' + this._username + '（已登录）';
                    display.style.color = '#27ae60';
                } else {
                    display.textContent = '未登录';
                    display.style.color = '#888';
                }
            }
            if(btnLogin) btnLogin.style.display = this._loggedIn ? 'none' : '';
            if(btnLogout) btnLogout.style.display = this._loggedIn ? '' : 'none';
            // 导航栏登录状态
            var navStatus = document.getElementById('nav-login-status');
            var navBtnLogin = document.getElementById('nav-btn-login');
            var navBtnLogout = document.getElementById('nav-btn-logout');
            if(navStatus){
                if(this._loggedIn){
                    navStatus.textContent = '👤 ' + this._username;
                    navStatus.style.color = '#27ae60';
                } else {
                    navStatus.textContent = '未登录';
                    navStatus.style.color = '#888';
                }
            }
            if(navBtnLogin) navBtnLogin.style.display = this._loggedIn ? 'none' : '';
            if(navBtnLogout) navBtnLogout.style.display = this._loggedIn ? '' : 'none';
        }
    };

    App.init = function(){
        App.Storage.ensureDefaults();
        App.Login.init();
        App.Sync.init();
        App.Toast.init();
        App.Effects.init();
        App.Students.render();
        App.Questions.render();
        App.Leaderboard.render();
        App.Settings.renderLevels();
        App.Settings.loadSoundSettings();
        App.Settings.loadAISettings();
        App.Settings.loadExamSettings();
        var progress=App.Storage.getExamProgress();
        if(progress&&progress.questions&&progress.questions.length>0){
            App.Exam.checkResumableExam();
        }
        document.getElementById('sound-volume').addEventListener('input',function(){
            App.Settings.saveSoundSettings();
        });
        document.getElementById('sound-enabled').addEventListener('change',function(){
            App.Settings.saveSoundSettings();
        });
    };

    document.addEventListener('DOMContentLoaded',function(){
        App.init();
    });
})();