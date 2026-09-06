import express from "express";
import http from "http";
import os from "os";
import { Server } from "socket.io";

const PORT = Number(process.env.PORT || 3000);
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: false },
  maxHttpBufferSize: 5e6
});

const state = {
  question: "問題が設定されるまでお待ちください",
  reveal: false,
  locked: false,
  round: 1,
  players: {}
};

const socketToPlayer = new Map();

function cleanText(value, maxLength) {
  return String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, maxLength);
}

function createPlayerId() {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function publicState() {
  return {
    question: state.question,
    reveal: state.reveal,
    locked: state.locked,
    round: state.round,
    players: state.players
  };
}

function broadcast() {
  io.emit("state", publicState());
}

function resetAnswers({ incrementRound = false } = {}) {
  state.reveal = false;
  state.locked = false;
  if (incrementRound) state.round += 1;
  for (const player of Object.values(state.players)) {
    player.answer = "";
    player.submitted = false;
    player.correct = null;
  }
}

io.on("connection", (socket) => {
  socket.emit("state", publicState());

  socket.on("player:join", (payload = {}, reply = () => {}) => {
    const name = cleanText(payload.name, 24);
    if (!name) return reply({ ok: false, message: "名前を入力してください。" });

    let playerId = cleanText(payload.playerId, 80);
    if (!playerId || !state.players[playerId]) playerId = createPlayerId();

    const existing = state.players[playerId];
    state.players[playerId] = {
      id: playerId,
      name,
      answer: existing?.answer ?? "",
      submitted: existing?.submitted ?? false,
      score: Number(existing?.score ?? 0),
      correct: existing?.correct ?? null,
      online: true,
      joinedAt: existing?.joinedAt ?? Date.now()
    };

    socketToPlayer.set(socket.id, playerId);
    socket.join(`player:${playerId}`);
    reply({ ok: true, playerId });
    broadcast();
  });

  socket.on("player:answer", (payload = {}, reply = () => {}) => {
    const playerId = socketToPlayer.get(socket.id);
    const player = state.players[playerId];
    if (!player) return reply({ ok: false, message: "参加し直してください。" });
    if (state.locked || state.reveal) return reply({ ok: false, message: "現在は回答を変更できません。" });

    const answer = String(payload.answer ?? "");
    const isDrawing = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(answer);
    if (!isDrawing) return reply({ ok: false, message: "手書き解答を入力してください。" });
    if (answer.length > 3500000) return reply({ ok: false, message: "画像が大きすぎます。全消去して書き直してください。" });

    player.answer = answer;
    player.submitted = true;
    player.correct = null;
    reply({ ok: true });
    broadcast();
  });

  socket.on("admin:setQuestion", (payload = {}, reply = () => {}) => {
    const question = cleanText(payload.question, 240);
    if (!question) return reply({ ok: false, message: "問題文を入力してください。" });
    state.question = question;
    resetAnswers({ incrementRound: true });
    reply({ ok: true });
    broadcast();
  });

  socket.on("admin:toggleLock", () => {
    if (!state.reveal) state.locked = !state.locked;
    broadcast();
  });

  socket.on("admin:reveal", () => {
    state.locked = true;
    state.reveal = true;
    broadcast();
  });

  socket.on("admin:hide", () => {
    state.reveal = false;
    broadcast();
  });

  socket.on("admin:resetAnswers", () => {
    resetAnswers();
    broadcast();
  });

  socket.on("admin:judge", (payload = {}) => {
    const playerId = cleanText(payload.playerId, 80);
    const correct = payload.correct === true;
    const player = state.players[playerId];
    if (!player) return;

    if (correct) {
      if (player.correct !== true) player.score += 1;
      player.correct = true;
    } else {
      if (player.correct === true) player.score = Math.max(0, player.score - 1);
      player.correct = false;
    }
    broadcast();
  });

  socket.on("admin:changeScore", (payload = {}) => {
    const playerId = cleanText(payload.playerId, 80);
    const delta = Number(payload.delta);
    const player = state.players[playerId];
    if (!player || !Number.isFinite(delta)) return;
    player.score = Math.max(0, player.score + Math.trunc(delta));
    broadcast();
  });

  socket.on("admin:removePlayer", (payload = {}) => {
    const playerId = cleanText(payload.playerId, 80);
    if (!state.players[playerId]) return;
    delete state.players[playerId];
    io.in(`player:${playerId}`).emit("player:removed");
    broadcast();
  });

  socket.on("admin:resetGame", () => {
    state.question = "問題が設定されるまでお待ちください";
    state.reveal = false;
    state.locked = false;
    state.round = 1;
    for (const player of Object.values(state.players)) {
      player.answer = "";
      player.submitted = false;
      player.score = 0;
      player.correct = null;
    }
    broadcast();
  });

  socket.on("disconnect", () => {
    const playerId = socketToPlayer.get(socket.id);
    socketToPlayer.delete(socket.id);
    const player = state.players[playerId];
    if (player) {
      player.online = false;
      broadcast();
    }
  });
});

const page = String.raw`<!doctype html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#07152f" />
  <title>Quiz Studio</title>
  <style>
    :root{--bg:#061127;--panel:#102958;--panel2:#17376e;--gold:#ffd54a;--cyan:#4de2ff;--white:#f8fbff;--muted:#aabbd9;--danger:#ff6577;--ok:#45df96;--shadow:0 16px 50px #0007}
    *{box-sizing:border-box}html,body{margin:0;min-height:100%;background:radial-gradient(circle at 50% -20%,#214d96 0,#081a3a 38%,var(--bg) 72%);color:var(--white);font-family:Inter,"Hiragino Sans","Yu Gothic",sans-serif}button,input,textarea{font:inherit}button{touch-action:manipulation}.hidden{display:none!important}
    .topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 24px;background:#030b1dcc;border-bottom:1px solid #ffffff20;position:sticky;top:0;z-index:10;backdrop-filter:blur(12px)}.brand{font-weight:900;letter-spacing:.13em;color:var(--gold);font-size:clamp(18px,3vw,28px)}.round{padding:7px 14px;border:1px solid #ffffff30;border-radius:999px;color:var(--muted)}
    main{width:min(1480px,100%);margin:auto;padding:clamp(16px,3vw,34px)}.hero{background:linear-gradient(135deg,#173f85,#0a2048);border:2px solid #5bd8ff55;border-radius:24px;padding:clamp(20px,4vw,42px);box-shadow:var(--shadow);text-align:center;margin-bottom:24px}.eyebrow{color:var(--cyan);font-weight:800;letter-spacing:.18em}.question{font-weight:900;font-size:clamp(26px,5vw,62px);line-height:1.25;margin:12px 0;overflow-wrap:anywhere}.status{color:var(--muted);font-weight:700}.status.locked{color:var(--gold)}.status.revealed{color:var(--ok)}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr));gap:18px}.card{background:linear-gradient(155deg,var(--panel2),var(--panel));border:1px solid #ffffff25;border-radius:22px;padding:20px;box-shadow:0 10px 30px #0005;min-width:0}.player-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.player-name{font-size:clamp(20px,3vw,30px);font-weight:900;overflow-wrap:anywhere}.score{color:var(--gold);font-size:22px;font-weight:900;white-space:nowrap}.dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#586a89;margin-right:8px}.dot.online{background:var(--ok);box-shadow:0 0 12px var(--ok)}.answer{margin-top:18px;min-height:96px;border-radius:15px;background:#050e22aa;padding:18px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:clamp(22px,4vw,42px);font-weight:900;overflow-wrap:anywhere}.answer.wait{color:var(--muted)}.answer.correct{outline:3px solid var(--ok);background:#0b5239}.answer.wrong{outline:3px solid var(--danger);background:#591d2c}
    .centerbox{width:min(680px,100%);margin:clamp(24px,8vh,90px) auto;background:linear-gradient(145deg,#173a77,#0b2048);padding:clamp(22px,5vw,46px);border-radius:28px;box-shadow:var(--shadow);border:1px solid #ffffff2c;text-align:center}.centerbox h1{font-size:clamp(34px,8vw,68px);margin:0 0 8px;color:var(--gold)}.lead{color:var(--muted);margin-bottom:28px}.field{width:100%;border:2px solid #ffffff25;background:#06142f;color:white;border-radius:15px;padding:16px 18px;outline:none;font-size:20px}.field:focus{border-color:var(--cyan);box-shadow:0 0 0 4px #4de2ff20}textarea.field{min-height:150px;resize:vertical;font-size:clamp(22px,5vw,36px);font-weight:800;margin-top:18px}.btn{border:0;border-radius:14px;padding:14px 20px;color:#071127;background:var(--gold);font-weight:900;cursor:pointer;min-height:52px}.btn:hover{filter:brightness(1.08)}.btn:disabled{opacity:.45;cursor:not-allowed}.btn.secondary{background:#ddecff}.btn.cyan{background:var(--cyan)}.btn.ok{background:var(--ok)}.btn.danger{background:var(--danger);color:white}.btn.dark{background:#081730;color:white;border:1px solid #ffffff33}.wide{width:100%;margin-top:14px;font-size:20px}.notice{margin-top:14px;min-height:24px;color:var(--cyan);font-weight:700}.navlinks{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:25px}.navlinks a{color:#cddcff}
    .admin-layout{display:grid;grid-template-columns:minmax(300px,440px) 1fr;gap:24px;align-items:start}.controls{position:sticky;top:86px}.controls h2{margin-top:0}.buttonrow{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}.buttonrow .btn{flex:1 1 130px}.admin-card-actions{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px}.admin-card-actions .btn{padding:9px 7px;min-height:42px}.small{font-size:13px;color:var(--muted)}.count{font-size:24px;font-weight:900;color:var(--cyan)}
    .player-pane{width:min(820px,100%);margin:auto}.submitted{border:2px solid var(--ok);background:#0b4535;border-radius:18px;padding:20px;text-align:center;margin-top:18px}.display main{width:min(1700px,100%)}.display .card{padding:25px}.display .answer{min-height:140px}
    .draw-wrap{margin-top:18px;background:#fff;border:3px solid #4de2ff;border-radius:18px;overflow:hidden;box-shadow:inset 0 0 0 1px #0002}.draw-canvas{display:block;width:100%;height:clamp(300px,52vh,560px);background:#fff;touch-action:none;cursor:crosshair}.draw-tools{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:12px}.tool-active{outline:4px solid #4de2ff55}.answer img{display:block;max-width:100%;max-height:220px;object-fit:contain;background:#fff;border-radius:10px}.display .answer img{max-height:320px}.handwriting-label{color:var(--muted);font-size:14px;margin-top:12px}
    @media(max-width:860px){.admin-layout{grid-template-columns:1fr}.controls{position:static}.topbar{padding:12px 16px}.admin-card-actions{grid-template-columns:repeat(2,1fr)}}
  </style>
</head>
<body>
  <header class="topbar"><div class="brand">QUIZ STUDIO</div><div class="round" id="roundLabel">ROUND 1</div></header>
  <main id="app"></main>
  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    const app = document.getElementById("app");
    const route = location.pathname.replace(/\/+$/, "") || "/";
    let quiz = { question:"", reveal:false, locked:false, round:1, players:{} };
    let joined = false;
    let currentPlayerId = localStorage.getItem("quizPlayerId") || "";
    let currentPlayerName = localStorage.getItem("quizPlayerName") || "";
    let draftImage = "";
    let drawingTool = "pen";
    let strokeHistory = [];

    const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    const players = () => Object.values(quiz.players).sort((a,b) => b.score-a.score || a.joinedAt-b.joinedAt);
    const statusText = () => quiz.reveal ? "回答公開中" : quiz.locked ? "回答受付終了" : "回答受付中";
    const statusClass = () => quiz.reveal ? "revealed" : quiz.locked ? "locked" : "";
    const hero = () => '<section class="hero"><div class="eyebrow">QUESTION</div><div class="question">'+esc(quiz.question)+'</div><div class="status '+statusClass()+'">'+statusText()+'</div></section>';
    const answerFor = (p, adminView=false) => {
      if (quiz.reveal || adminView) return p.answer ? '<img src="'+esc(p.answer)+'" alt="'+esc(p.name)+'の手書き解答">' : '<span class="wait">未回答</span>';
      return p.submitted ? '<span style="color:var(--gold)">回答済み</span>' : '<span class="wait">考え中...</span>';
    };
    const playerCard = (p, adminView=false) => '<article class="card"><div class="player-head"><div class="player-name"><span class="dot '+(p.online?'online':'')+'"></span>'+esc(p.name)+'</div><div class="score">'+p.score+' 点</div></div><div class="answer '+(p.correct===true?'correct':p.correct===false?'wrong':'')+'">'+answerFor(p,adminView)+'</div>'+(adminView?'<div class="admin-card-actions"><button class="btn ok" data-act="correct" data-id="'+esc(p.id)+'">正解</button><button class="btn danger" data-act="wrong" data-id="'+esc(p.id)+'">不正解</button><button class="btn dark" data-act="minus" data-id="'+esc(p.id)+'">-1点</button><button class="btn dark" data-act="remove" data-id="'+esc(p.id)+'">削除</button></div>':'')+'</article>';

    function updateRound(){ document.getElementById("roundLabel").textContent = "ROUND " + quiz.round; }

    function renderPlayer(){
      if (!joined) {
        app.innerHTML = '<section class="centerbox"><h1>QUIZ</h1><div class="lead">名前を入力してクイズに参加してください。</div><input id="name" class="field" maxlength="24" autocomplete="name" placeholder="出場者名" value="'+esc(currentPlayerName)+'"><button id="join" class="btn wide">参加する</button><div id="notice" class="notice"></div><div class="navlinks"><a href="/display">全画面表示</a><a href="/admin">司会画面</a></div></section>';
        document.getElementById("join").onclick = joinPlayer;
        document.getElementById("name").onkeydown = e => { if(e.key === "Enter") joinPlayer(); };
        return;
      }
      const me = quiz.players[currentPlayerId];
      if (!me) { joined=false; return renderPlayer(); }
      const disabled = quiz.locked || quiz.reveal;
      if (!draftImage && me.answer) draftImage = me.answer;
      app.innerHTML = '<div class="player-pane">'+hero()+'<section class="card"><div class="player-head"><div class="player-name">'+esc(me.name)+'</div><div class="score">'+me.score+' 点</div></div><div class="handwriting-label">Apple Pencilまたは指で白い欄に解答を書いてください。</div><div class="draw-wrap"><canvas id="drawCanvas" class="draw-canvas" aria-label="手書き解答欄"></canvas></div><div class="draw-tools"><button id="penTool" class="btn dark '+(drawingTool==='pen'?'tool-active':'')+'" '+(disabled?'disabled':'')+'>ペン</button><button id="eraserTool" class="btn dark '+(drawingTool==='eraser'?'tool-active':'')+'" '+(disabled?'disabled':'')+'>消しゴム</button><button id="clearCanvas" class="btn danger" '+(disabled?'disabled':'')+'>全消去</button></div><button id="submit" class="btn wide cyan" '+(disabled?'disabled':'')+'>'+(me.submitted?'解答を更新する':'解答を送信する')+'</button><div id="notice" class="notice">'+(disabled?'現在、解答はロックされています。':me.submitted?'解答を送信済みです。公開までお待ちください。':'')+'</div></section></div>';
      setupDrawingCanvas(disabled);
      if (!disabled) {
        document.getElementById("submit").onclick = submitAnswer;
        document.getElementById("penTool").onclick = () => setDrawingTool("pen");
        document.getElementById("eraserTool").onclick = () => setDrawingTool("eraser");
        document.getElementById("clearCanvas").onclick = clearDrawing;
      }
    }

    function joinPlayer(){
      const name = document.getElementById("name").value.trim();
      socket.emit("player:join", { name, playerId: currentPlayerId }, result => {
        const notice = document.getElementById("notice");
        if (!result?.ok) { notice.textContent = result?.message || "参加できませんでした。"; return; }
        currentPlayerId = result.playerId;
        currentPlayerName = name;
        localStorage.setItem("quizPlayerId", currentPlayerId);
        localStorage.setItem("quizPlayerName", currentPlayerName);
        joined = true;
        renderPlayer();
      });
    }

    function setDrawingTool(tool){
      drawingTool = tool;
      document.getElementById("penTool")?.classList.toggle("tool-active", tool === "pen");
      document.getElementById("eraserTool")?.classList.toggle("tool-active", tool === "eraser");
    }

    function setupDrawingCanvas(disabled){
      const canvas = document.getElementById("drawCanvas");
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(600, Math.round(rect.width * ratio));
      canvas.height = Math.max(500, Math.round(rect.height * ratio));
      const ctx = canvas.getContext("2d", { alpha:false });
      ctx.fillStyle = "white";
      ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (draftImage) {
        const image = new Image();
        image.onload = () => ctx.drawImage(image,0,0,canvas.width,canvas.height);
        image.src = draftImage;
      }
      if (disabled) return;
      let active = false;
      let lastX = 0, lastY = 0;
      const point = e => {
        const r = canvas.getBoundingClientRect();
        return [(e.clientX-r.left)*canvas.width/r.width, (e.clientY-r.top)*canvas.height/r.height];
      };
      canvas.addEventListener("pointerdown", e => {
        e.preventDefault(); active=true; canvas.setPointerCapture(e.pointerId);
        [lastX,lastY]=point(e);
      });
      canvas.addEventListener("pointermove", e => {
        if(!active) return; e.preventDefault();
        const [x,y]=point(e);
        const pressure = e.pressure > 0 ? e.pressure : 0.5;
        ctx.strokeStyle = drawingTool === "eraser" ? "white" : "#071127";
        ctx.lineWidth = drawingTool === "eraser" ? 42*ratio : Math.max(4*ratio, 8*ratio*pressure);
        ctx.beginPath(); ctx.moveTo(lastX,lastY); ctx.lineTo(x,y); ctx.stroke();
        lastX=x; lastY=y;
      });
      const finish = e => { if(active){ active=false; draftImage=canvas.toDataURL("image/jpeg",0.82); } };
      canvas.addEventListener("pointerup", finish);
      canvas.addEventListener("pointercancel", finish);
    }

    function clearDrawing(){
      const canvas=document.getElementById("drawCanvas");
      if(!canvas) return;
      const ctx=canvas.getContext("2d",{alpha:false});
      ctx.fillStyle="white"; ctx.fillRect(0,0,canvas.width,canvas.height);
      draftImage="";
      const notice=document.getElementById("notice");
      if(notice) notice.textContent="解答欄を消去しました。";
    }

    function submitAnswer(){
      const canvas = document.getElementById("drawCanvas");
      if (!canvas) return;
      const answer = canvas.toDataURL("image/jpeg", 0.82);
      draftImage = answer;
      socket.emit("player:answer", { answer }, result => {
        const notice = document.getElementById("notice");
        notice.textContent = result?.ok ? "手書き解答を送信しました。" : (result?.message || "送信できませんでした。");
      });
    }

    function renderDisplay(){
      app.innerHTML = '<div class="display">'+hero()+'<section class="grid">'+(players().length?players().map(p=>playerCard(p,false)).join(""):'<div class="centerbox"><div class="lead">参加者を待っています。</div></div>')+'</section></div>';
    }

    function renderAdmin(){
      const submitted = players().filter(p=>p.submitted).length;
      app.innerHTML = '<div class="admin-layout"><section class="card controls"><h2>司会コントロール</h2><div class="small">参加者</div><div class="count">'+players().length+' 人、回答済み '+submitted+' 人</div><textarea id="questionInput" class="field" maxlength="240" placeholder="問題文を入力">'+esc(quiz.question)+'</textarea><button id="setQuestion" class="btn wide cyan">新しい問題を出題</button><div class="buttonrow"><button id="toggleLock" class="btn">'+(quiz.locked?'回答受付を再開':'回答を締め切る')+'</button><button id="reveal" class="btn ok">一斉公開</button><button id="hide" class="btn secondary">回答を隠す</button><button id="resetAnswers" class="btn dark">回答のみ消去</button></div><div class="buttonrow"><button id="openDisplay" class="btn secondary">表示画面を開く</button><button id="resetGame" class="btn danger">全得点をリセット</button></div><div id="notice" class="notice"></div><div class="small">この司会画面には認証を設けていません。ローカルネットワーク内で使用してください。</div></section><section><div class="hero"><div class="eyebrow">QUESTION</div><div class="question">'+esc(quiz.question)+'</div><div class="status '+statusClass()+'">'+statusText()+'</div></div><div class="grid">'+(players().length?players().map(p=>playerCard(p,true)).join(""):'<div class="card">参加者を待っています。</div>')+'</div></section></div>';
      document.getElementById("setQuestion").onclick = () => socket.emit("admin:setQuestion", {question:document.getElementById("questionInput").value}, showAdminResult);
      document.getElementById("toggleLock").onclick = () => socket.emit("admin:toggleLock");
      document.getElementById("reveal").onclick = () => socket.emit("admin:reveal");
      document.getElementById("hide").onclick = () => socket.emit("admin:hide");
      document.getElementById("resetAnswers").onclick = () => socket.emit("admin:resetAnswers");
      document.getElementById("openDisplay").onclick = () => window.open("/display", "quizDisplay");
      document.getElementById("resetGame").onclick = () => { if(confirm("全員の得点と回答をリセットしますか？")) socket.emit("admin:resetGame"); };
      app.querySelectorAll("[data-act]").forEach(btn => btn.onclick = () => {
        const id=btn.dataset.id, act=btn.dataset.act;
        if(act==="correct") socket.emit("admin:judge",{playerId:id,correct:true});
        if(act==="wrong") socket.emit("admin:judge",{playerId:id,correct:false});
        if(act==="minus") socket.emit("admin:changeScore",{playerId:id,delta:-1});
        if(act==="remove" && confirm("この参加者を削除しますか？")) socket.emit("admin:removePlayer",{playerId:id});
      });
    }

    function showAdminResult(result){ const n=document.getElementById("notice"); if(n) n.textContent=result?.ok?"出題しました。":(result?.message||""); }
    function render(){ updateRound(); if(route==="/admin") renderAdmin(); else if(route==="/display") renderDisplay(); else renderPlayer(); }

    socket.on("state", next => {
      const currentCanvas = document.getElementById("drawCanvas");
      const previousRound = quiz.round;
      if (currentCanvas && joined && !quiz.locked && !quiz.reveal) draftImage = currentCanvas.toDataURL("image/jpeg",0.82);
      quiz = next;
      if (previousRound !== quiz.round) draftImage = "";
      if (route === "/" && currentPlayerId && quiz.players[currentPlayerId]) joined = true;
      render();
    });
    socket.on("player:removed", () => {
      localStorage.removeItem("quizPlayerId"); currentPlayerId=""; joined=false; render();
    });
  </script>
</body>
</html>`;

app.get(["/", "/admin", "/display"], (_req, res) => res.type("html").send(page));
app.get("/health", (_req, res) => res.json({ ok: true, port: PORT }));

server.listen(PORT, "0.0.0.0", () => {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) addresses.push(entry.address);
    }
  }
  console.log("\nQuiz Studio is running.");
  console.log(`PC:      http://localhost:${PORT}`);
  for (const address of addresses) {
    console.log(`Player:  http://${address}:${PORT}`);
    console.log(`Admin:   http://${address}:${PORT}/admin`);
    console.log(`Display: http://${address}:${PORT}/display`);
  }
  console.log("\nStop: Ctrl+C\n");
});
