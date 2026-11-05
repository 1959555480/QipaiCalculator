// pages/room/room.js
const app = getApp();

Page({
  data: {
    roomId: '',
    action: '',
    isCreator: false,
    allowJoin: true,
    players: [],
    history: [],
    historyView: [],
    showScoreModal: false,
    selectedPlayer: null,
    inputScore: 0,
    userId: null,
    userInfo: null,
  },

  onLoad(options) {
    const userInfo = this.getLocalUserInfo();
    this.setData({ userInfo });

    // 测试模式：假数据，不访问云端（开发者工具编译模式加 test=1 时可预览 UI）
    if (options.test === '1') {
      this.setData({
        roomId: 'TEST001',
        action: 'test',
        isCreator: true,
        allowJoin: true,
        userId: 'me',
        history: [],
        historyView: [],
        players: this.normalizePlayers([
          { id: 'me', openid: 'me', name: userInfo.name, avatar: userInfo.avatar, isOwner: true, score: 100 },
          { id: 'user2', openid: 'user2', name: '玩家2', avatar: '🎮', isOwner: false, score: 85 },
          { id: 'user3', openid: 'user3', name: '玩家3', avatar: '🎯', isOwner: false, score: 92 }
        ]),
      });
      return;
    }

    const { roomId, action } = options;
    this.setData({ roomId: roomId || '', action });

    // 先拿到 openid，再创建/加入，保证"不能给自己记分"的判断可靠
    app.getUserId((openid) => {
      this.setData({ userId: openid });
      if (action === 'create') {
        this.createRoom(userInfo);
      } else if (roomId) {
        this.joinRoom(roomId, userInfo);
      }
    });
  },

  onShow() {
    // 从后台/其他页面回来后恢复轮询
    if (this.roomReady && !this.pollTimer) {
      this.startPolling();
    }
  },

  onHide() {
    this.stopPolling();
  },

  onUnload() {
    this.stopPolling();
    // 通过返回键/侧滑离开时也同步云端状态（onUnload 不能等待，发出即可）
    if (this.roomReady && !this.hasLeft) {
      this.leaveRoom().catch(console.error);
    }
  },

  // 当前用户信息（昵称+头像一次成型，避免后续逻辑覆盖掉头像）
  getLocalUserInfo() {
    const cached = wx.getStorageSync('userInfo') || {};
    let name = (cached.name || '').trim();
    if (!name || name === '点击授权') {
      name = '玩家' + Math.floor(1000 + Math.random() * 9000);
      wx.setStorageSync('userInfo', { ...cached, name });
    }
    const avatar = wx.getStorageSync('avatarUrl') || cached.avatar || '👤';
    return { ...cached, name, avatar };
  },

  // 判断玩家头像该用图片还是 emoji 兜底（cloud:// 文件ID、网络地址、本地临时路径都算图片）
  normalizePlayers(players) {
    const cache = this.getAvatarUrlCache();
    const broken = this.getAvatarBroken();
    const now = Date.now();
    return (players || []).map(p => {
      const rawAvatar = p.avatar || '👤';
      // 这张头像加载失败过就先用 emoji，避免轮询时反复重试造成闪动
      const isBroken = !!(broken[rawAvatar] && broken[rawAvatar] > now);
      const avatarSrc = isBroken ? '' : (cache[rawAvatar] || rawAvatar);
      const showAvatarImage = !isBroken && /^(https?:|cloud:\/\/|wxfile:\/\/|file:)/.test(avatarSrc);
      return { ...p, avatar: isBroken ? '👤' : rawAvatar, avatarSrc, showAvatarImage };
    });
  },

  getAvatarBroken() {
    if (!this.avatarBroken) this.avatarBroken = {};
    return this.avatarBroken;
  },

  getAvatarUrlCache() {
    if (!this.avatarUrlCache) this.avatarUrlCache = {};
    return this.avatarUrlCache;
  },

  // 云函数下发头像临时链接时并入缓存（管理端权限，不受存储 ACL 限制）
  mergeAvatarUrls(urls) {
    if (!urls) return;
    const cache = this.getAvatarUrlCache();
    Object.keys(urls).forEach(fileID => {
      // 已有缓存不覆盖：不同云函数实例换出的链接不同，覆盖会让图片反复重新加载
      if (urls[fileID] && !cache[fileID]) cache[fileID] = urls[fileID];
    });
  },

  // 把 cloud:// 文件ID 换成临时可访问链接（带缓存，避免每次轮询都请求）
  resolveAvatarUrls(players) {
    const cache = this.getAvatarUrlCache();
    const failed = this.avatarUrlFailed || (this.avatarUrlFailed = {});
    const now = Date.now();
    const fileList = [];

    (players || []).forEach(p => {
      const avatar = p.avatar || '';
      if (avatar.indexOf('cloud://') !== 0) return;
      if (cache[avatar]) return;
      // 失败后 60 秒内不重试，避免轮询时刷屏
      if (failed[avatar] && failed[avatar] > now) return;
      if (fileList.indexOf(avatar) < 0) fileList.push(avatar);
    });

    if (!fileList.length || !wx.cloud || !wx.cloud.getTempFileURL) return null;

    return wx.cloud.getTempFileURL({ fileList: fileList }).then(res => {
      (res.fileList || []).forEach(f => {
        if (f.fileID && f.tempFileURL) {
          cache[f.fileID] = f.tempFileURL;
        } else {
          failed[f.fileID] = now + 60 * 1000;
          // 常见原因：云存储权限不是「所有用户可读」
          console.warn('头像临时链接获取失败', f.fileID, f.status, f.errMsg);
        }
      });
    }).catch(err => {
      fileList.forEach(f => { failed[f] = now + 60 * 1000; });
      console.error(err);
    });
  },

  // 渲染玩家列表：数据没变化就不 setData，避免轮询时头像反复重绘
  updatePlayers(players) {
    const next = this.normalizePlayers(players);
    if (this.playersChanged(next)) {
      this.setData({ players: next });
    }

    const task = this.resolveAvatarUrls(players);
    if (!task) return;
    task.then(() => {
      const resolved = this.normalizePlayers(players);
      if (this.playersChanged(resolved)) {
        this.setData({ players: resolved });
      }
    });
  },

  // 玩家列表关键字段是否变化（头像链接变化也要补渲染）
  playersChanged(next) {
    const prev = this.data.players || [];
    if (prev.length !== next.length) return true;
    for (let i = 0; i < next.length; i++) {
      const a = prev[i];
      const b = next[i];
      if (a.id !== b.id || a.name !== b.name || a.score !== b.score || a.avatarSrc !== b.avatarSrc || !!a.isOwner !== !!b.isOwner) {
        return true;
      }
    }
    return false;
  },

  // 历史记录是否变化（倒序后的列表）
  historyChanged(next) {
    const prev = this.data.historyView || [];
    if (prev.length !== next.length) return true;
    for (let i = 0; i < next.length; i++) {
      if (prev[i].changesText !== next[i].changesText || prev[i].time !== next[i].time) {
        return true;
      }
    }
    return false;
  },

  // 历史记录按时间倒序展示（云端是按顺序追加的）
  normalizeHistory(history) {
    return (history || []).slice().reverse();
  },

  // 复制房间号
  copyRoomId() {
    if (!this.data.roomId) return;
    wx.setClipboardData({
      data: String(this.data.roomId)
    });
  },

  // 图片加载失败（比如别人留下的本机临时路径）时退回 emoji
  onAvatarError(e) {
    const id = e.currentTarget.dataset.id;
    const player = this.data.players.find(p => p.id === id);
    // 便于定位：是临时路径、链接过期，还是云存储无读权限
    console.warn('头像加载失败', id, player && { avatar: player.avatar, avatarSrc: player.avatarSrc });
    if (player && player.avatar && player.avatar !== '👤') {
      // 10 分钟内不再尝试这张头像，避免轮询来回切换造成闪动
      this.getAvatarBroken()[player.avatar] = Date.now() + 10 * 60 * 1000;
    }
    const players = this.data.players.map(p =>
      p.id === id ? { ...p, avatar: '👤', avatarSrc: '', showAvatarImage: false } : p
    );
    this.setData({ players });
  },

  // 创建房间
  createRoom(userInfo) {
    wx.showLoading({ title: '创建房间...' });
    
    app.call('room', {
      action: 'create',
      name: userInfo.name,
      avatar: userInfo.avatar
    }).then(res => {
      wx.hideLoading();
      const result = res.result || {};
      
      if (result.success) {
        const room = result.room || {};
        const roomId = result.roomId || room.roomId;
        this.setData({
          roomId: roomId,
          isCreator: true,
          allowJoin: room.allowJoin !== false,
          history: room.history || [],
          historyView: this.normalizeHistory(room.history),
          userId: app.setOpenid(result.openid) || this.data.userId
        });
        this.mergeAvatarUrls(result.avatarUrls);
        this.updatePlayers(room.players);
        this.roomReady = true;
        this.saveRecentRoom(roomId);
        // 房主也要轮询，否则看不到其他人加入
        this.startPolling();
      } else {
        wx.showToast({ title: result.error || '创建失败', icon: 'none' });
      }
    }).catch(err => {
      wx.hideLoading();
      console.error(err);
      wx.showToast({ title: '创建失败', icon: 'none' });
    });
  },

  // 加入房间
  joinRoom(roomId, userInfo) {
    wx.showLoading({ title: '加入房间...' });
    
    app.call('room', {
      action: 'join',
      roomId: roomId,
      name: userInfo.name,
      avatar: userInfo.avatar
    }).then(res => {
      wx.hideLoading();
      const result = res.result || {};
      
      if (result.success) {
        const room = result.room || {};
        const openid = app.setOpenid(result.openid) || this.data.userId;
        this.setData({
          isCreator: !!openid && room.createdBy === openid,
          allowJoin: room.allowJoin !== false,
          history: room.history || [],
          historyView: this.normalizeHistory(room.history),
          userId: openid
        });
        this.mergeAvatarUrls(result.avatarUrls);
        this.updatePlayers(room.players);
        this.roomReady = true;
        this.saveRecentRoom(roomId);
        this.startPolling();
      } else {
        wx.showToast({ title: result.error || '加入失败', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 1500);
      }
    }).catch(err => {
      wx.hideLoading();
      console.error(err);
      wx.showToast({ title: '加入失败', icon: 'none' });
    });
  },

  // 拉取一次最新房间数据
  refreshRoom() {
    if (!this.data.roomId || this.data.action === 'test') return Promise.resolve();
    
    return app.call('room', {
      action: 'get',
      roomId: this.data.roomId
    }).then(res => {
      const result = res.result || {};
      if (!result.success) return;
      const room = result.room || {};
      const openid = app.setOpenid(result.openid) || this.data.userId;
      const isCreator = !!openid && room.createdBy === openid;
      const allowJoin = room.allowJoin !== false;
      const history = room.history || [];
      const historyView = this.normalizeHistory(history);

      // 只写有变化的字段，避免每 2 秒整页重绘
      const patch = {};
      if (this.data.isCreator !== isCreator) patch.isCreator = isCreator;
      if (this.data.allowJoin !== allowJoin) patch.allowJoin = allowJoin;
      if (this.data.userId !== openid) patch.userId = openid;
      if (this.historyChanged(historyView)) {
        patch.history = history;
        patch.historyView = historyView;
      }
      if (Object.keys(patch).length) {
        this.setData(patch);
      }

      this.mergeAvatarUrls(result.avatarUrls);
      this.updatePlayers(room.players);
    }).catch(console.error);
  },

  // 轮询获取最新数据
  startPolling() {
    this.stopPolling();
    if (!this.roomReady || this.data.action === 'test') return;
    
    this.pollTimer = setInterval(() => {
      this.refreshRoom();
    }, 2000);
  },

  // 停止轮询（页面隐藏/卸载时必须调用，避免定时器泄漏）
  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  },

  // 切换加入开关
  toggleJoin(e) {
    const allowJoin = e.detail.value;
    this.setData({ allowJoin });
    
    app.call('room', {
      action: 'update',
      roomId: this.data.roomId,
      data: { allowJoin: allowJoin }
    }).catch(console.error);
  },

  // 更新玩家名字
  updatePlayerName(e) {
    const id = e.currentTarget.dataset.id;
    const newName = e.detail.value.trim();
    if (!newName) return;
    
    const players = this.data.players.map(p => 
      p.id === id ? { ...p, name: newName } : p
    );
    this.setData({ players });
    
    app.call('room', {
      action: 'update',
      roomId: this.data.roomId,
      data: { players: players }
    }).catch(console.error);
  },

  // 点击玩家头像
  onPlayerTap(e) {
    const playerId = e.currentTarget.dataset.id;
    const player = this.data.players.find(p => p.id === playerId);
    if (!player) return;
    
    // 不能给自己记分（用 openid 判断，房主也可以被其他人记分）
    const myId = this.data.userId;
    if (myId && (player.id === myId || player.openid === myId)) {
      wx.showToast({ title: '不能给自己记分', icon: 'none' });
      return;
    }
    this.setData({
      showScoreModal: true,
      selectedPlayer: player,
      inputScore: 0
    });
  },

  // 关闭计分弹窗
  closeScoreModal() {
    this.setData({
      showScoreModal: false,
      selectedPlayer: null,
      inputScore: 0
    });
  },

  // 选择快捷分数
  selectQuickScore(e) {
    const score = parseInt(e.currentTarget.dataset.score);
    this.setData({ inputScore: score });
  },

  // 输入分数
  onScoreInput(e) {
    let value = e.detail.value;
    // 只允许输入正整数
    value = value.replace(/[^0-9]/g, '');
    value = value.replace(/^0+/, ''); // 去掉开头的0
    this.setData({ inputScore: value });
  },

  // 确认提交分数
  confirmScore() {
    const { selectedPlayer, inputScore, roomId, players } = this.data;
    const score = parseInt(inputScore) || 0;

    if (!selectedPlayer) return;

    // 只能是正整数
    if (score <= 0 || isNaN(score)) {
      wx.showToast({ title: '请输入正整数', icon: 'none' });
      return;
    }

    // 测试模式直接更新
    if (this.data.action === 'test' || this.data.roomId === 'TEST001') {
      const myId = this.data.userId;
      const me = players.find(p => p.id === myId || p.openid === myId);
      // 给对方加分，自己扣同样的分（可为负）
      const updatedPlayers = players.map(p => {
        if (p.id === selectedPlayer.id) return { ...p, score: p.score + score };
        if (me && p.id === me.id) return { ...p, score: p.score - score };
        return p;
      });
      const now = new Date();
      const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
      const changesText = `${selectedPlayer.name}: +${score}` + (me ? `，${me.name}: -${score}` : '');
      const newHistory = [...this.data.history, {
        time: time,
        changesText: changesText,
        submitBy: selectedPlayer.id
      }];


      this.setData({
        players: updatedPlayers,
        history: newHistory,
        historyView: this.normalizeHistory(newHistory),
        showScoreModal: false,
        selectedPlayer: null,
        inputScore: 0
      });

      wx.showToast({ title: '已记分', icon: 'success' });
      return;
    }

    // 正式模式调用云函数
    wx.showLoading({ title: '保存中...' });
    app.call('room', {
      action: 'submitScore',
      roomId: roomId,
      scores: [{
        openid: selectedPlayer.openid || selectedPlayer.id,
        delta: score
      }]
    }).then(res => {
      wx.hideLoading();
      const result = res.result || {};
      if (result.success) {
        this.setData({
          showScoreModal: false,
          selectedPlayer: null,
          inputScore: 0
        });
        wx.showToast({ title: '已记分', icon: 'success' });
        // 立即拉一次最新分数，不必等下一轮轮询
        this.refreshRoom();
      } else {
        wx.showToast({ title: result.error || '保存失败', icon: 'none' });
      }
    }).catch(err => {
      wx.hideLoading();
      console.error(err);
      wx.showToast({ title: '保存失败', icon: 'none' });
    });
  },

  // 显示计分面板（保留兼容）
  showScorePanel() {
    this.onPlayerTap({ currentTarget: { dataset: { id: this.data.players[0]?.id } } });
  },

  hideScorePanel() {
    this.closeScoreModal();
  },

  // 退出房间：移除自己，房主退出时由云函数移交给下一位
  leaveRoom() {
    if (this.hasLeft || this.data.action === 'test' || !this.data.roomId) {
      return Promise.resolve({ result: { success: true } });
    }
    this.hasLeft = true;
    return app.call('room', {
      action: 'leave',
      roomId: this.data.roomId
    });
  },

  // 返回首页
  goHome() {
    this.stopPolling();
    
    const backHome = () => wx.reLaunch({ url: '/pages/index/index' });
    
    if (this.data.action === 'test' || !this.data.roomId) {
      backHome();
      return;
    }
    
    wx.showLoading({ title: '正在退出...' });
    this.leaveRoom().then(res => {
      wx.hideLoading();
      const result = res.result || {};
      if (result.success) {
        backHome();
        return;
      }
      wx.showToast({ title: result.error || '退出失败', icon: 'none' });
      setTimeout(backHome, 800);
    }).catch(err => {
      wx.hideLoading();
      console.error(err);
      backHome();
    });
  },

  // 保存最近房间
  saveRecentRoom(roomId) {
    let recent = wx.getStorageSync('recentRooms') || [];
    recent = recent.filter(r => r.id !== roomId);
    recent.unshift({ id: roomId, date: new Date().toLocaleDateString() });
    recent = recent.slice(0, 5);
    wx.setStorageSync('recentRooms', recent);
  },
});
