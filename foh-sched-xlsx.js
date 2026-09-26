// ── Roster Excel / HR email — split-shift hotfix (26 Sep 2026) ──────────────
// Loaded right AFTER foh-core.js, so this definition replaces the one there.
// The old builder wrote only the first shift of a split (12:00-15:00 instead of
// 12:00-15:00 + 19:00-01:00) and counted only its hours. Shipped as its own
// small file so it could go live from a phone; fold it back into foh-core.js
// (and delete this file + its script tag) on the next full push.
async function fohSchedSendToHR(_downloadOnly){
  var _wkEnd = addDays(fohSchedWeekStart, 6);
  var _wkStr = fohSchedWeekStart.toLocaleDateString('en-GB',{day:'numeric',month:'short'}) + ' to ' + _wkEnd.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
  // The scope string reset_log actually stores for a roster send — the long form
  // built below from `days`. Built here too, because the dialog has to know
  // whether this week has been sent before it opens.
  var _fullWk = fohSchedWeekStart.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) +
    ' to ' + _wkEnd.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
  var _note = '', _isUpdate = false;
  if(!_downloadOnly){
    var rosterWho = await fohRequireStaffId("email this week's roster (" + _wkStr + ") to HR", 'roster');
    if(!rosterWho) return;
    // Have we sent this week before? Only pre-ticks the box in the dialog — the
    // person sending decides, so a missing or unreadable log costs nothing.
    var _wasSent=false;
    try {
      var _prior=await sb.from('reset_log').select('id')
        .eq('app','foh').eq('action','roster_send').eq('scope',_fullWk).limit(1);
      _wasSent=!!(_prior && _prior.data && _prior.data.length);
    } catch(e){ console.warn('[roster] re-send check failed', e); }
    var _ask = await fohHRNoteAsk(_wkStr, _wasSent);
    if(!_ask) return;                        // Cancel means nothing is sent.
    _note = _ask.note; _isUpdate = _ask.update;
  }
  var btn = _downloadOnly ? null : document.getElementById('foh-svt-hr');
  if(btn){ btn.textContent = '⏳ Generating...'; btn.disabled = true; }
  try {
    var days = [];
    for(var i=0;i<7;i++) days.push(addDays(fohSchedWeekStart,i));
    var dayNames = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    var weekStr = days[0].toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) +
      ' to ' + days[6].toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});

    // Load ExcelJS
    await new Promise(function(resolve,reject){
      if(window.ExcelJS){ resolve(); return; }
      var s=document.createElement('script');
      s.src='https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
      s.onload=resolve; s.onerror=reject;
      document.head.appendChild(s);
    });

    var workbook = new ExcelJS.Workbook();
    workbook.creator = "Roberto's FOH";
    workbook.created = new Date();
    var sheet = workbook.addWorksheet('FOH Roster',{ pageSetup:{orientation:'landscape',fitToPage:true,fitToWidth:1} });

    var VINO='6B1F2A', SABBIA='F5F0E8', GOLD='C9A84C', DARK='3D0F15', LIGHT='F0EBE2';

    function vinoBorder(){
      return {top:{style:'thin',color:{argb:'FF'+GOLD}},bottom:{style:'thin',color:{argb:'FF'+GOLD}},left:{style:'thin',color:{argb:'FF'+GOLD}},right:{style:'thin',color:{argb:'FF'+GOLD}}};
    }
    function hairBorder(){
      return {top:{style:'hair',color:{argb:'FFDDDDDD'}},bottom:{style:'hair',color:{argb:'FFDDDDDD'}},left:{style:'hair',color:{argb:'FFDDDDDD'}},right:{style:'hair',color:{argb:'FFDDDDDD'}}};
    }

    sheet.columns = [{width:28},{width:22},{width:14},{width:14},{width:14},{width:14},{width:14},{width:14},{width:14},{width:13},{width:11}];
    var totalCols = 11;

    // Title
    var titleRow = sheet.addRow(["ROBERTO'S DIFC — FOH Roster: " + weekStr]);
    titleRow.height = 36;
    sheet.mergeCells(titleRow.number,1,titleRow.number,totalCols);
    titleRow.getCell(1).style = {
      font:{bold:true,size:16,color:{argb:'FF'+SABBIA},name:'Calibri'},
      fill:{type:'pattern',pattern:'solid',fgColor:{argb:'FF'+VINO}},
      alignment:{horizontal:'center',vertical:'middle'}
    };

    var subRow = sheet.addRow(["Generated: " + new Date().toLocaleString('en-GB') + "   |   Week: " + weekStr]);
    subRow.height = 18;
    sheet.mergeCells(subRow.number,1,subRow.number,totalCols);
    subRow.getCell(1).style = {
      font:{size:9,color:{argb:'FF'+VINO},italic:true,name:'Calibri'},
      fill:{type:'pattern',pattern:'solid',fgColor:{argb:'FF'+SABBIA}},
      alignment:{horizontal:'center',vertical:'middle'}
    };
    sheet.addRow([]);

    // Header row
    var hdrCells = ['Name','Role'];
    for(var di=0;di<days.length;di++) hdrCells.push(dayNames[di]+' '+days[di].toLocaleDateString('en-GB',{day:'numeric',month:'short'}));
    hdrCells.push('Total Hours','Days Worked');
    var hdrRow = sheet.addRow(hdrCells);
    hdrRow.height = 32;
    hdrRow.eachCell(function(cell){
      cell.style = {
        font:{bold:true,size:10,color:{argb:'FF'+SABBIA},name:'Calibri'},
        fill:{type:'pattern',pattern:'solid',fgColor:{argb:'FF'+VINO}},
        alignment:{horizontal:'center',vertical:'middle',wrapText:true},
        border:vinoBorder()
      };
    });

    // Data rows by section
    FOH_SECTIONS.forEach(function(sec){
      var stStaff = fohSchedVisibleIn(fohSchedStaff.filter(function(s){ return s.section===sec.key; }), days.map(formatDate));
      if(!stStaff.length) return;

      var stRow = sheet.addRow([sec.label.toUpperCase()]);
      stRow.height = 20;
      sheet.mergeCells(stRow.number,1,stRow.number,totalCols);
      stRow.getCell(1).style = {
        font:{bold:true,size:10,color:{argb:'FFFFFFF0'},name:'Calibri'},
        fill:{type:'pattern',pattern:'solid',fgColor:{argb:'FF'+DARK}},
        alignment:{horizontal:'left',vertical:'middle',indent:1}
      };

      stStaff.forEach(function(staff){
        var rowData = [staff.name, staff.role];
        var wHours=0, wDays=0;
        var cellStatuses=[];
        var hasSplitRow=false;
        for(var dj=0;dj<days.length;dj++){
          var ds = formatDate(days[dj]);
          var entry = fohSchedRoster[fohSchedRosterKey(staff.id,ds)];
          if(!entry || entry.status==='working'){
            var ts=entry?formatTime(entry.shift_start):'', te=entry?formatTime(entry.shift_end):'';
            var ts2=entry?formatTime(entry.shift_start2):'', te2=entry?formatTime(entry.shift_end2):'';   // split shift — same as the Print view
            if(ts&&te){ var h=calcHours(ts,te,ts2,te2); wHours+=h; wDays++; if(ts2&&te2) hasSplitRow=true; rowData.push(ts+'-'+te+(ts2&&te2?('\n'+ts2+'-'+te2):'')); cellStatuses.push('working'); }
            else { rowData.push(''); cellStatuses.push('empty'); }
          } else {
            var meta=FOH_STATUS_META[entry.status]||{label:entry.status.toUpperCase()};
            if(entry.status!=='off') wDays++;
            rowData.push(meta.label); cellStatuses.push(entry.status);
          }
        }
        rowData.push(wHours>0?(Math.round(wHours*10)/10)+'h':'', wDays||'');
        var dataRow=sheet.addRow(rowData);
        dataRow.height=hasSplitRow?30:18;   // two lines when someone has a split shift
        dataRow.eachCell({includeEmpty:true},function(cell,colNumber){
          var baseFont={size:10,name:'Calibri'};
          var col=colNumber-1;
          var fills={working:'FFFFFFFF',off:'FFF5F5F5',wo:'FFDBEAFE',sl:'FFFFF3C7',al:'FFD1FAE5',ph:'FFEDE9FE',em:'FFFEE2E2',tr:'FFCCFBF1',cat:'FFFFEDD5',fs:'FFE2E8F0',empty:'FFFFFFFF'};
          var fgColors={working:'FF333333',off:'FF999999',wo:'FF1e40af',sl:'FF92400e',al:'FF065f46',ph:'FF5b21b6',em:'FF991b1b',tr:'FF134e4a',cat:'FF9a3412',fs:'FF334155',empty:'FFCCCCCC'};
          if(col===0){ cell.style={font:Object.assign({bold:true},baseFont),fill:{type:'pattern',pattern:'solid',fgColor:{argb:'FF'+SABBIA}},border:hairBorder(),alignment:{vertical:'middle'}}; }
          else if(col===1){ cell.style={font:Object.assign({italic:true,color:{argb:'FF888888'}},baseFont),fill:{type:'pattern',pattern:'solid',fgColor:{argb:'FF'+SABBIA}},border:hairBorder(),alignment:{vertical:'middle'}}; }
          else if(col>=rowData.length-2){ cell.style={font:Object.assign({bold:true,color:{argb:'FF'+VINO}},baseFont),fill:{type:'pattern',pattern:'solid',fgColor:{argb:'FF'+LIGHT}},border:hairBorder(),alignment:{horizontal:'center',vertical:'middle'}}; }
          else {
            var status=cellStatuses[col-2];
            cell.style={
              font:Object.assign({bold:status!=='working'&&status!=='empty',color:{argb:fgColors[status]||'FF333333'}},baseFont),
              fill:{type:'pattern',pattern:'solid',fgColor:{argb:fills[status]||'FFFFFFFF'}},
              border:hairBorder(),alignment:{horizontal:'center',vertical:'middle',wrapText:true}
            };
          }
        });
      });
      sheet.addRow([]);
    });

    var xlsxBuffer = await workbook.xlsx.writeBuffer();
    var fileName = 'FOH_Roster_'+formatDate(days[0])+'_to_'+formatDate(days[6])+'.xlsx';
    if(_downloadOnly){ return { xlsxBuffer:xlsxBuffer, fileName:fileName, weekStr:weekStr, days:days }; }
    var xlsxBase64 = btoa(String.fromCharCode.apply(null, new Uint8Array(xlsxBuffer)));

    if(btn) btn.textContent = '📧 Sending...';

    // "This replaces a roster I already sent" — read off the dialog above, where
    // the re-send record only pre-ticked the box. The person sending gets the
    // last word: they know whether HR has seen this week better than a log does.

    // Use Kitchen App edge function (same Resend setup, same recipients for now)
    var emailRes = await fetch('https://zrpglswalgjbtghudmhu.supabase.co/functions/v1/send-roster', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+KITCHEN_KEY },
      body:JSON.stringify({ weekStr:weekStr, fileName:fileName, xlsxBase64:xlsxBase64, source:'FOH',
                            sentBy:rosterWho.name, update:_isUpdate, note:_note,
                            testTo: fohRosterTestTo() || undefined })
    });

    var emailData = await emailRes.json();
    if(!emailRes.ok) throw new Error(emailData.message||'Email failed: '+emailRes.status);
    // The function reports back how much of the note it actually printed. If we
    // typed one and it arrived empty, the tick must not say it went.
    if(_note && !emailData.noted) throw new Error('The roster was sent, but your note did not reach the email. Please tell HR the change directly.');

    fohLogSend(rosterWho, 'roster_send', weekStr);

    // The roster reached HR either way, so this is not a failure — but if the Cc
    // list did not come from Admin → Emails, then whoever was ticked or unticked
    // on that screen was ignored, and a green tick says the exact opposite of
    // what happened.
    //
    // This is not hypothetical. Between 1 and 14 Aug 2026 the key that reads that
    // screen was the wrong one, every roster went to a hardcoded list that
    // pre-dated Ouafaa, and the button said "✓ Sent to HR" every single time. The
    // function had been reporting usedFallback all along; nothing displayed it.
    // A flag nobody shows is the same as no flag at all.
    var fellBack = emailData.usedFallback === true;
    var copied   = (emailData.recipients || []);

    if(fellBack){
      alert('The roster WAS sent to HR — but the copy list did not come from Admin → Emails.\n\n'
        + (emailData.fallbackReason ? 'Reason: ' + emailData.fallbackReason + '.\n\n' : '')
        + 'The app used its built-in list instead, so these ' + copied.length + ' were copied:\n\n'
        + copied.join('\n')
        + '\n\nAnyone you have added or removed on Admin → Emails was ignored on this send. '
        + 'HR has the roster, so nothing needs re-sending — but please report this so the list can be fixed.');
    }

    if(btn){
      // Says who, not just that it went — the whole point of the screen is which
      // people got it, and that is the thing that was silently wrong.
      var okLabel = (_note ? '✓ Sent with your note' : '✓ Sent to HR')
                  + (copied.length ? ' · ' + copied.length + ' copied' : '');
      btn.textContent = fellBack ? '⚠ Sent — wrong copy list' : okLabel;
      if(fellBack){
        btn.style.background='rgba(180,83,9,.3)'; btn.style.borderColor='rgba(180,83,9,.7)'; btn.style.color='#f0b17a';
      } else {
        btn.style.background='rgba(45,122,79,.3)'; btn.style.borderColor='rgba(45,122,79,.6)'; btn.style.color='#7fc08e';
      }
      // A warning has to outlast a glance; a tick does not.
      setTimeout(function(){ btn.textContent='📧 Send to HR'; btn.style.background=''; btn.style.borderColor=''; btn.style.color=''; btn.disabled=false; }, fellBack ? 12000 : 3000);
    }
  } catch(err){
    console.error('FOH Send to HR error:',err);
    alert('Failed: '+(err.message||err));
    if(btn){ btn.textContent='📧 Send to HR'; btn.disabled=false; }
  }
}
