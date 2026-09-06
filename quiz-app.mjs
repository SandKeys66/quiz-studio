
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
    if (state.locked) return reply({ ok: false, message: "現在は回答を変更できません。" });

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
    state.locked = !state.locked;
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
      player.correct = true;
    } else {
      player.correct = false;
    }
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
    :root{--bg:#c92f2c;--panel:#b92428;--panel2:#d13a33;--gold:#f4d35e;--cyan:#f4d35e;--white:#fffdf7;--muted:#f6e8bf;--danger:#8d1219;--ok:#3ca66b;--shadow:0 14px 34px #4a080866}
    *{box-sizing:border-box}html,body{margin:0;min-height:100%;background:linear-gradient(180deg,#d23a32 0%,var(--bg) 48%,#bd2529 100%);color:var(--white);font-family:Inter,"Hiragino Sans","Yu Gothic",sans-serif}button,input,textarea{font:inherit}button{touch-action:manipulation}.hidden{display:none!important}
    .topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 24px;background:#b82025f2;border-bottom:3px solid var(--gold);position:sticky;top:0;z-index:10;backdrop-filter:blur(12px)}.brand{font-weight:900;letter-spacing:.13em;color:var(--gold);font-size:clamp(18px,3vw,28px)}.round{padding:7px 14px;border:1px solid #ffffff30;border-radius:999px;color:var(--muted)}
    main{width:min(1480px,100%);margin:auto;padding:clamp(16px,3vw,34px)}.hero{background:linear-gradient(135deg,#d43b34,#b91f25);border:3px solid var(--gold);border-radius:24px;padding:clamp(20px,4vw,42px);box-shadow:var(--shadow);text-align:center;margin-bottom:24px}.eyebrow{color:var(--cyan);font-weight:800;letter-spacing:.18em}.question{font-weight:900;font-size:clamp(26px,5vw,62px);line-height:1.25;margin:12px 0;overflow-wrap:anywhere}.status{color:var(--muted);font-weight:700}.status.locked{color:var(--gold)}.status.revealed{color:var(--ok)}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr));gap:18px}.card{background:linear-gradient(155deg,var(--panel2),var(--panel));border:1px solid #ffffff25;border-radius:22px;padding:20px;box-shadow:0 10px 30px #0005;min-width:0}.player-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.player-name{font-size:clamp(20px,3vw,30px);font-weight:900;overflow-wrap:anywhere}.dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#586a89;margin-right:8px}.dot.online{background:var(--ok);box-shadow:0 0 12px var(--ok)}.answer{margin-top:18px;min-height:96px;border-radius:15px;background:#050e22aa;padding:18px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:clamp(22px,4vw,42px);font-weight:900;overflow-wrap:anywhere}.answer.wait{color:var(--muted)}.answer.correct{outline:3px solid var(--ok);background:#0b5239}.answer.wrong{outline:3px solid var(--danger);background:#591d2c}
    .centerbox{width:min(680px,100%);margin:clamp(24px,8vh,90px) auto;background:linear-gradient(145deg,#d43b34,#b91f25);padding:clamp(22px,5vw,46px);border-radius:28px;box-shadow:var(--shadow);border:1px solid #ffffff2c;text-align:center}.centerbox h1{font-size:clamp(34px,8vw,68px);margin:0 0 8px;color:var(--gold)}.lead{color:var(--muted);margin-bottom:28px}.field{width:100%;border:2px solid #ffffff25;background:#a91c22;color:white;border-radius:15px;padding:16px 18px;outline:none;font-size:20px}.field:focus{border-color:var(--cyan);box-shadow:0 0 0 4px #f4d35e44}textarea.field{min-height:150px;resize:vertical;font-size:clamp(22px,5vw,36px);font-weight:800;margin-top:18px}.btn{border:0;border-radius:14px;padding:14px 20px;color:#071127;background:var(--gold);font-weight:900;cursor:pointer;min-height:52px}.btn:hover{filter:brightness(1.08)}.btn:disabled{opacity:.45;cursor:not-allowed}.btn.secondary{background:#ddecff}.btn.cyan{background:var(--cyan)}.btn.ok{background:var(--ok)}.btn.danger{background:var(--danger);color:white}.btn.dark{background:#7e1117;color:white;border:1px solid #ffffff33}.wide{width:100%;margin-top:14px;font-size:20px}.notice{margin-top:14px;min-height:24px;color:var(--cyan);font-weight:700}.navlinks{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:25px}.navlinks a{color:#cddcff}
    .admin-layout{display:grid;grid-template-columns:minmax(300px,440px) 1fr;gap:24px;align-items:start}.controls{position:sticky;top:86px}.controls h2{margin-top:0}.buttonrow{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}.buttonrow .btn{flex:1 1 130px}.admin-card-actions{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}.admin-card-actions .btn{padding:9px 7px;min-height:42px}.small{font-size:13px;color:var(--muted)}.count{font-size:24px;font-weight:900;color:var(--cyan)}
    .player-pane{width:min(820px,100%);margin:auto}.submitted{border:2px solid var(--ok);background:#0b4535;border-radius:18px;padding:20px;text-align:center;margin-top:18px}.display main{width:min(1700px,100%)}.display .card{padding:25px}.display .answer{min-height:140px}
    .draw-wrap{margin-top:18px;background:#fff;border:3px solid var(--gold);border-radius:18px;overflow:hidden;box-shadow:inset 0 0 0 1px #0002}.draw-canvas{display:block;width:100%;height:clamp(260px,48vh,520px);background:#fff;touch-action:none;cursor:crosshair}.draw-tools{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:12px}.tool-active{outline:4px solid #f4d35e88}.answer img{display:block;width:100%;max-width:100%;max-height:220px;object-fit:contain;background:#fff;border-radius:10px}.drawing-image{display:flex;width:100%;min-height:80px;align-items:center;justify-content:center}.display .answer img{max-height:320px}.handwriting-label{color:var(--muted);font-size:14px;margin-top:12px}
    .player-page{height:100%;min-height:100%;overflow:hidden;background:#cb302d}.player-page .topbar{height:52px;padding:8px 16px;position:relative}.player-page main{height:calc(100vh - 52px);height:calc(100dvh - 52px);min-height:0;padding:8px 12px;overflow:hidden}.player-page .player-pane{height:100%;width:min(900px,100%);display:flex;flex-direction:column}.player-page .hero{flex:0 0 auto;margin-bottom:7px;padding:7px 14px;border-radius:14px}.player-page .eyebrow{display:none}.player-page .question{margin:0;font-size:clamp(18px,3.2vmin,30px);line-height:1.15}.player-page .status{font-size:12px;margin-top:3px}.player-page .player-pane>.card{flex:1;min-height:0;display:flex;flex-direction:column;padding:9px 12px;border-radius:14px}.player-page .player-head{flex:0 0 auto;min-height:26px}.player-page .player-name{font-size:clamp(17px,2.8vmin,24px)}.player-page .handwriting-label{flex:0 0 auto;margin-top:3px;font-size:11px}.player-page .draw-wrap{flex:1;min-height:110px;margin-top:5px;border-width:3px;border-radius:12px}.player-page .draw-canvas{width:100%;height:100%;min-height:110px}.player-page .draw-tools{flex:0 0 auto;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:6px}.player-page .btn{min-height:38px;padding:7px 10px;border-radius:10px}.player-page .wide{flex:0 0 auto;margin-top:6px;min-height:42px;font-size:16px}.player-page .notice{flex:0 0 auto;min-height:17px;margin-top:3px;font-size:12px;line-height:1.2}.player-page .card:before{display:none}@media(max-width:600px){.player-page .topbar{height:44px;padding:6px 12px}.player-page .brand{font-size:16px}.player-page .round{padding:4px 9px;font-size:12px}.player-page main{height:calc(100vh - 44px);height:calc(100dvh - 44px);padding:5px 7px}.player-page .hero{padding:5px 9px;margin-bottom:5px}.player-page .question{font-size:clamp(16px,4.3vw,23px)}.player-page .player-pane>.card{padding:6px 8px}.player-page .handwriting-label{display:none}.player-page .draw-wrap{margin-top:4px}.player-page .btn{min-height:34px;padding:5px 7px;font-size:13px}.player-page .wide{min-height:38px;font-size:15px}.player-page .notice{font-size:10px}}@media(max-height:600px) and (orientation:landscape){.player-page .topbar{height:38px;padding:4px 12px}.player-page .brand{font-size:14px}.player-page .round{padding:3px 8px;font-size:11px}.player-page main{height:calc(100vh - 38px);height:calc(100dvh - 38px);padding:4px 8px}.player-page .hero{padding:3px 10px;margin-bottom:4px}.player-page .question{font-size:16px}.player-page .status{display:none}.player-page .player-head{min-height:20px}.player-page .player-name{font-size:15px}.player-page .handwriting-label{display:none}.player-page .player-pane>.card{padding:5px 8px}.player-page .draw-wrap{margin-top:3px;min-height:80px}.player-page .draw-canvas{min-height:80px}.player-page .draw-tools{margin-top:4px;gap:5px}.player-page .btn{min-height:30px;padding:3px 7px;font-size:12px}.player-page .wide{min-height:32px;margin-top:4px;font-size:13px}.player-page .notice{min-height:12px;margin-top:2px;font-size:9px}}
    .display{height:100%;padding:14px;background:#cb302d}.display-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-template-rows:repeat(2,minmax(0,1fr));height:calc(100vh - 28px);gap:14px}.display-grid .card{display:flex;flex-direction:column;min-height:0;padding:12px;border:4px solid var(--gold);border-radius:12px;background:linear-gradient(180deg,#a91820 0 50px,#fff9e8 50px 100%);box-shadow:5px 6px 0 #1118}.display-grid .card:before{display:none}.display-grid .player-head{min-height:34px;padding:0 4px;justify-content:center;text-align:center}.display-grid .player-name{width:100%;text-align:center;color:var(--gold);font-size:clamp(18px,1.8vw,29px);text-shadow:2px 2px 0 #111}.display-grid .dot{display:none}.display-grid .answer{flex:1;min-height:0;margin-top:8px;padding:6px;background:#fffdf7;border:3px solid #111;border-radius:6px}.display-grid .drawing-image{width:100%;height:100%}.display-grid .answer img{width:100%;height:100%;max-height:none;object-fit:contain}.display-grid .wait{color:#7a2626;text-shadow:none}.display-page{overflow:hidden;background:#cb302d}.display-page .topbar{display:none}.display-page main{width:100%;max-width:none;height:100vh;padding:0}.brand{color:var(--gold);text-shadow:3px 3px 0 #111}.card{border-color:#f4d35e88;position:relative}.card:before{content:"";position:absolute;left:18px;right:18px;top:0;height:3px;background:linear-gradient(90deg,transparent,var(--gold),transparent);border-radius:999px}.btn{box-shadow:0 4px 0 #571014}.btn.cyan{color:#15100a;background:linear-gradient(180deg,#f5df7a,#e9bc3d)}.btn.ok{background:linear-gradient(180deg,#65dc97,#2ba965)}
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
    if (route === "/") document.body.classList.add("player-page");
    if (route === "/admin") document.body.classList.add("admin-page");
    let quiz = { question:"", reveal:false, locked:false, round:1, players:{} };
    let joined = false;
    let currentPlayerId = localStorage.getItem("quizPlayerId") || "";
    let currentPlayerName = localStorage.getItem("quizPlayerName") || "";
    let draftImage = "";
    let drawingTool = "pen";
    let strokeHistory = [];

    const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    const players = () => Object.values(quiz.players).sort((a,b) => a.joinedAt-b.joinedAt);
    const statusText = () => quiz.reveal ? "回答公開中" : quiz.locked ? "回答受付終了" : "回答受付中";
    const statusClass = () => quiz.reveal ? "revealed" : quiz.locked ? "locked" : "";
    const hero = () => '<section class="hero"><div class="eyebrow">QUESTION</div><div class="question">'+esc(quiz.question)+'</div><div class="status '+statusClass()+'">'+statusText()+'</div></section>';
    const answerFor = (p, adminView=false) => {
      return p.answer
        ? '<div class="drawing-image" data-player-id="'+esc(p.id)+'"></div>'
        : '<span class="wait">未回答</span>';
    };

    function renderDrawingImages(){
      document.querySelectorAll(".drawing-image[data-player-id]").forEach(holder => {
        const player = quiz.players[holder.dataset.playerId];
        const source = player?.answer;
        if (!source || !/^data:image\/(png|jpeg);base64,/.test(source)) {
          holder.innerHTML = '<span class="wait">画像を読み込めません</span>';
          return;
        }
        const image = new Image();
        image.alt = player.name + "の手書き解答";
        image.decoding = "async";
        image.onload = () => {
          holder.replaceChildren(image);
        };
        image.onerror = () => {
          holder.innerHTML = '<span class="wait">画像の表示に失敗しました</span>';
        };
        image.src = source;
      });
    }
    const playerCard = (p, adminView=false) => '<article class="card"><div class="player-head"><div class="player-name"><span class="dot '+(p.online?'online':'')+'"></span>'+esc(p.name)+'</div></div><div class="answer '+(p.correct===true?'correct':p.correct===false?'wrong':'')+'">'+answerFor(p,adminView)+'</div>'+(adminView?'<div class="admin-card-actions"><button class="btn ok" data-act="correct" data-id="'+esc(p.id)+'">正解</button><button class="btn danger" data-act="wrong" data-id="'+esc(p.id)+'">不正解</button><button class="btn dark" data-act="remove" data-id="'+esc(p.id)+'">削除</button></div>':'')+'</article>';

    function updateRound(){ document.getElementById("roundLabel").textContent = "ROUND " + quiz.round; }

    function renderPlayer(){
      if (!joined) {
        app.innerHTML = '<section class="centerbox"><h1>QUIZ</h1><div class="lead">名前を入力してクイズに参加してください。</div><input id="name" class="field" maxlength="24" autocomplete="name" placeholder="出場者名" value="'+esc(currentPlayerName)+'"><button id="join" class="btn wide">参加する</button><div id="notice" class="notice"></div></section>';
        document.getElementById("join").onclick = joinPlayer;
        document.getElementById("name").onkeydown = e => { if(e.key === "Enter") joinPlayer(); };
        return;
      }
      const me = quiz.players[currentPlayerId];
      if (!me) { joined=false; return renderPlayer(); }
      const disabled = quiz.locked;
      if (!draftImage && me.answer) draftImage = me.answer;
      app.innerHTML = '<div class="player-pane">'+hero()+'<section class="card"><div class="player-head"><div class="player-name">'+esc(me.name)+'</div></div><div class="handwriting-label">Apple Pencilまたは指で白い欄に解答を書いてください。</div><div class="draw-wrap"><canvas id="drawCanvas" class="draw-canvas" aria-label="手書き解答欄"></canvas></div><div class="draw-tools"><button id="penTool" class="btn dark '+(drawingTool==='pen'?'tool-active':'')+'" '+(disabled?'disabled':'')+'>ペン</button><button id="eraserTool" class="btn dark '+(drawingTool==='eraser'?'tool-active':'')+'" '+(disabled?'disabled':'')+'>消しゴム</button><button id="clearCanvas" class="btn danger" '+(disabled?'disabled':'')+'>全消去</button></div><button id="submit" class="btn wide cyan" '+(disabled?'disabled':'')+'>'+(me.submitted?'解答を更新する':'解答を送信する')+'</button><div id="notice" class="notice">'+(disabled?'現在、解答はロックされています。':me.submitted?'解答を送信済みです。表示画面へ反映されています。':'')+'</div></section></div>';
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
        e.preventDefault();
        active = true;
        canvas.setPointerCapture(e.pointerId);
        [lastX,lastY]=point(e);
      });
      canvas.addEventListener("pointermove", e => {
        if(!active) return;
        e.preventDefault();
        const [x,y]=point(e);
        const pressure = e.pressure > 0 ? e.pressure : 0.5;
        ctx.strokeStyle = drawingTool === "eraser" ? "white" : "#18100d";
        ctx.lineWidth = drawingTool === "eraser" ? 42*ratio : Math.max(4*ratio, 8*ratio*pressure);
        ctx.beginPath(); ctx.moveTo(lastX,lastY); ctx.lineTo(x,y); ctx.stroke();
        lastX=x; lastY=y;
      });
      const finish = e => {
        if(!active) return;
        active = false;
        draftImage = canvas.toDataURL("image/jpeg",0.82);
      };
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
      document.body.classList.add("display-page");
      const visiblePlayers = players().slice(0, 6);
      app.innerHTML = '<div class="display"><section class="display-grid">'+(visiblePlayers.length?visiblePlayers.map(p=>playerCard(p,false)).join(""):'<div class="centerbox"><div class="lead">参加者を待っています。</div></div>')+'</section></div>';
      renderDrawingImages();
    }

    function renderAdmin(){
      const submitted = players().filter(p=>p.submitted).length;
      app.innerHTML = '<div class="admin-layout"><section class="card controls"><h2>司会コントロール</h2><div class="small">参加者</div><div class="count">'+players().length+' 人、回答済み '+submitted+' 人</div><textarea id="questionInput" class="field" maxlength="240" placeholder="問題文を入力">'+esc(quiz.question)+'</textarea><button id="setQuestion" class="btn wide cyan">新しい問題を出題</button><div class="buttonrow"><button id="toggleLock" class="btn">'+(quiz.locked?'回答受付を再開':'回答を締め切る')+'</button><button id="resetAnswers" class="btn dark">回答のみ消去</button></div><div class="buttonrow"><button id="openDisplay" class="btn secondary">表示画面を開く</button><button id="resetGame" class="btn danger">全得点をリセット</button></div><div id="notice" class="notice"></div><div class="small">この司会画面には認証を設けていません。司会画面のURLは参加者に共有しないでください。</div></section><section><div class="hero"><div class="eyebrow">QUESTION</div><div class="question">'+esc(quiz.question)+'</div><div class="status '+statusClass()+'">'+statusText()+'</div></div><div class="grid">'+(players().length?players().map(p=>playerCard(p,true)).join(""):'<div class="card">参加者を待っています。</div>')+'</div></section></div>';
      document.getElementById("setQuestion").onclick = () => socket.emit("admin:setQuestion", {question:document.getElementById("questionInput").value}, showAdminResult);
      document.getElementById("toggleLock").onclick = () => socket.emit("admin:toggleLock");
      document.getElementById("resetAnswers").onclick = () => socket.emit("admin:resetAnswers");
      document.getElementById("openDisplay").onclick = () => window.open("/display", "quizDisplay");
      document.getElementById("resetGame").onclick = () => { if(confirm("全員の得点と回答をリセットしますか？")) socket.emit("admin:resetGame"); };
      renderDrawingImages();
      app.querySelectorAll("[data-act]").forEach(btn => btn.onclick = () => {
        const id=btn.dataset.id, act=btn.dataset.act;
        if(act==="correct") socket.emit("admin:judge",{playerId:id,correct:true});
        if(act==="wrong") socket.emit("admin:judge",{playerId:id,correct:false});
        if(act==="remove" && confirm("この参加者を削除しますか？")) socket.emit("admin:removePlayer",{playerId:id});
      });
    }

    function showAdminResult(result){ const n=document.getElementById("notice"); if(n) n.textContent=result?.ok?"出題しました。":(result?.message||""); }
    function render(){ updateRound(); if(route==="/admin") renderAdmin(); else if(route==="/display") renderDisplay(); else renderPlayer(); }

    socket.on("state", next => {
      const currentCanvas = document.getElementById("drawCanvas");
      const previousRound = quiz.round;
      if (currentCanvas && joined && !quiz.locked) draftImage = currentCanvas.toDataURL("image/jpeg",0.82);
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
