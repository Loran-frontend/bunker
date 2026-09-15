const socket = io(window.BUNKER_SOCKET_URL || undefined, { transports: ["websocket", "polling"], reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 500, reconnectionDelayMax: 5000 });
const SocketHandler = {
  createRoom(name){socket.emit('room:create',{name});}, joinRoom(name,roomId){socket.emit('room:join',{name,roomId});}, updateSettings(settings){socket.emit('room:settings',settings);}, sendChatMessage(text){socket.emit('chat:message',{text});}, startGame(){socket.emit('game:start');}, nextPhase(){socket.emit('game:next_phase');}, revealCard(category){socket.emit('card:reveal',{category});}, useCardAction(category,targetId){socket.emit('card:action',{category,targetId});}, castVote(targetId){socket.emit('vote:cast',{targetId});},
  createAlliance(targetId){socket.emit('alliance:create',{targetId});}, acceptAlliance(fromId){socket.emit('alliance:accept',{fromId});}, breakAlliance(allianceId){socket.emit('alliance:break',{allianceId});}, updateTrust(targetId,delta){socket.emit('trust:update',{targetId,delta});}, heal(targetId){socket.emit('state:heal',{targetId});}, sabotage(action){socket.emit('traitor:sabotage',{action});}, sendVoiceSignal(targetId,signal){socket.emit('voice:signal',{targetId,signal});}, sendVoiceSpeaking(isSpeaking){socket.emit('voice:speaking',{isSpeaking});},
  initListeners(){
    socket.on('room:created',(data)=>UI.updateGameState(data.state)); socket.on('game:init',(state)=>UI.updateGameState(state)); socket.on('room:updated',(state)=>UI.updateGameState(state)); socket.on('timer:tick',(data)=>UI.updateTimer(data.timeLeft)); socket.on('vote:update',(data)=>UI.updateVoteCounts(data.voteCounts));
    socket.on('action:private',(data)=>{
      if(data?.title==='🤝 Предложение союза'){
        const state=UI.currentState||null;
        const match=String(data.message||'').match(/^(.+?) предлагает вам/);
        const senderName=match?.[1];
        const sender=senderName&&state?.players?.find(p=>p.name===senderName);
        if(sender&&confirm(`${data.message}\n\nПринять союз?`)) SocketHandler.acceptAlliance(sender.id);
        else UI.showPrivateModal(data.title,data.message);
        return;
      }
      UI.showPrivateModal(data.title,data.message);
    });
    socket.on('log:new',(m)=>UI.appendLog(m)); socket.on('game:sabotage',(data)=>UI.showMechanicsNotice?.(`⚠️ Саботаж: ${data.action}`));
    socket.on('voice:signal',(data)=>{if(window.VoiceChat)window.VoiceChat.handleSignal(data.senderId,data.signal);}); socket.on('voice:speaking_update',(data)=>UI.updateSpeakingStatus(data.playerId,data.isSpeaking)); socket.on('game:finale',(result)=>UI.showFinaleModal(result)); socket.on('error:msg',(msg)=>alert(msg));
  }
};
