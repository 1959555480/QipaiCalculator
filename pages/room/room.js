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
    showScorePanel: false,
    userId: null,
  },

  onLoad(options) {
    const { roomId, action } = options;
    this.setData({ roomId, action });
    
    app.getUserInfo((userInfo) => {
      this.setData({ userInfo });
      
      if (action === 'create') {
        this.createRoom(roomId, userInfo);
      } else {
        this.joinRoom(roomId, userInfo);
      }
    });
  },

  onUnload() {
    // 清理
  },

  // 创建房间
  createRoom(roomId, userInfo) {
    wx.showLoading({ title: '创建房间...' });
    
    app.call('room', {
      action: 'create',
      roomId: roomId,
      name: userInfo.name,
      avatar: userInfo.avatar
    }).then(res => {
      wx.hideLoading();
      
      if (res.result && res.result.success) {
        const room = res.result.room;
        this.setData({
          isCreator: true,
          allowJoin: room.allowJoin,
          players: room.players,
          history: room.history || []
        });
        this.saveRecentRoom(roomId);
      } else {
        wx.showToast({ title: '创建失败', icon: 'none' });
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
      
      if (res.result && res.result.success) {
        const room = res.result.room;
        this.setData({
          isCreator: room.players.length === 1,
          allowJoin: room.allowJoin,
          players: room.players,
          history: room.history || []
        });
        this.saveRecentRoom(roomId);
        this.startPolling();
      } else {
        wx.showToast({ title: res.result.error || '加入失败', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 1500);
      }
    }).catch(err => {
      wx.hideLoading();
      console.error(err);
      wx.showToast({ title: '加入失败', icon: 'none' });
    });
  },

  // 轮询获取最新数据
  startPolling() {
    this.pollTimer = setInterval(() => {
      app.call('room', {
        action: 'get',
        roomId: this.data.roomId
      }).then(res => {
        if (res.result && res.result.success) {
          const room = res.result.room;
          this.setData({
            allowJoin: room.allowJoin,
            players: room.players,
            history: room.history || []
          });
        }
      }).catch(console.error);
    }, 2000);
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

  // 显示计分面板
  showScorePanel() {
    const players = this.data.players.map(p => ({ ...p, tempScore: 0 }));
    this.setData({ players, showScorePanel: true });
  },

  hideScorePanel() {
    this.setData({ showScorePanel: false });
  },

  // 输入分数
  onScoreInput(e) {
    const id = e.currentTarget.dataset.id;
    const value = parseInt(e.detail.value) || 0;
    
    const players = this.data.players.map(p =>
      p.id === id ? { ...p, tempScore: value } : p
    );
    this.setData({ players });
  },

  // 提交分数
  submitScore() {
    const { players, roomId } = this.data;
    let hasInput = false;
    let scores = [];
    
    players.forEach(p => {
      if (p.tempScore !== 0) {
        hasInput = true;
        scores.push({
          openid: p.openid,
          delta: p.tempScore
        });
      }
    });
    
    if (!hasInput) {
      wx.showToast({ title: '请输入分数', icon: 'none' });
      return;
    }
    
    wx.showLoading({ title: '保存中...' });
    
    app.call('room', {
      action: 'submitScore',
      roomId: roomId,
      scores: scores
    }).then(res => {
      wx.hideLoading();
      
      if (res.result && res.result.success) {
        const updatedPlayers = players.map(p => ({ ...p, tempScore: 0 }));
        this.setData({ players: updatedPlayers, showScorePanel: false });
        wx.showToast({ title: '已保存', icon: 'success' });
      } else {
        wx.showToast({ title: '保存失败', icon: 'none' });
      }
    }).catch(err => {
      wx.hideLoading();
      wx.showToast({ title: '保存失败', icon: 'none' });
    });
  },

  // 返回首页
  goHome() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }
    wx.reLaunch({ url: '/pages/index/index' });
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
