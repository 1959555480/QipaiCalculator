// pages/index/index.js
const app = getApp();

Page({
  data: {
    recentRooms: [],
    showModal: false,
    joinInput: '',
  },

  onLoad() {
    // 获取用户信息
    app.getUserInfo((userInfo) => {
      this.setData({ userInfo });
    });
  },

  onShow() {
    this.loadRecentRooms();
  },

  // 创建房间
  createRoom() {
    const roomId = this.generateRoomId();
    wx.navigateTo({
      url: `/pages/room/room?roomId=${roomId}&action=create`,
    });
  },

  // 显示加入弹窗
  showJoinModal() {
    this.setData({ showModal: true, joinInput: '' });
  },

  // 关闭弹窗
  closeModal() {
    this.setData({ showModal: false });
  },

  // 输入房间号
  onJoinInput(e) {
    this.setData({ joinInput: e.detail.value });
  },

  // 加入房间
  joinRoom() {
    const roomId = this.data.joinInput.trim();
    if (!roomId) {
      wx.showToast({ title: '请输入房间号', icon: 'none' });
      return;
    }
    this.setData({ showModal: false });
    wx.navigateTo({
      url: `/pages/room/room?roomId=${roomId}&action=join`,
    });
  },

  // 快速加入
  quickJoin(e) {
    const roomId = e.currentTarget.dataset.roomid;
    wx.navigateTo({
      url: `/pages/room/room?roomId=${roomId}&action=join`,
    });
  },

  // 生成4位房间号
  generateRoomId() {
    return Math.floor(1000 + Math.random() * 9000).toString();
  },

  // 加载最近房间
  loadRecentRooms() {
    const recent = wx.getStorageSync('recentRooms') || [];
    this.setData({ recentRooms: recent.slice(0, 5) });
  },
});
