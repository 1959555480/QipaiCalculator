// app.js
App({
  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({
        env: 'cloud1-6gd9msfpc3b53edf', // ⚠️ 填你的云环境ID
        traceUser: true,
      });
      // 提前拿到 openid，房间页判断"自己"时可直接使用
      this.getUserId(() => {});
    }
  },
  
  globalData: {
    userInfo: null,
    openid: null,
  },
  
  // 调用云函数
  call(action, data = {}) {
    return wx.cloud.callFunction({
      name: action,
      data: data
    });
  },
  
  // 获取用户ID
  getUserId(callback) {
    let openid = wx.getStorageSync('openid');
    if (openid) {
      this.globalData.openid = openid;
      callback(openid);
      return;
    }
    
    this.call('login').then(res => {
      if (res.result && res.result.openid) {
        callback(this.setOpenid(res.result.openid));
      } else {
        callback(this.getLocalUserId());
      }
    }).catch(() => {
      callback(this.getLocalUserId());
    });
  },
  
  // 缓存 openid（云函数返回值优先，保证与云数据库中的玩家一致）
  setOpenid(openid) {
    if (!openid) return wx.getStorageSync('openid') || this.globalData.openid || null;
    this.globalData.openid = openid;
    if (wx.getStorageSync('openid') !== openid) {
      wx.setStorageSync('openid', openid);
    }
    return openid;
  },
  
  // 云环境不可用时的本地兜底ID（不写入 openid，避免挡住后续真正登录）
  getLocalUserId() {
    let id = wx.getStorageSync('localUserId');
    if (!id) {
      id = 'user_' + Math.random().toString(36).substr(2, 9);
      wx.setStorageSync('localUserId', id);
    }
    return id;
  },
  
  // 获取用户信息
  getUserInfo(callback) {
    // 先从缓存读取
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo && userInfo.name && userInfo.name !== '点击授权') {
      this.globalData.userInfo = userInfo;
      callback(userInfo);
      return;
    }
    
    // 缓存没有，强制弹窗授权
    this.doAuthorize(callback);
  },
  
  // 执行授权
  doAuthorize(callback) {
    const defaultUser = { name: '点击授权', avatar: '👤' };
    
    if (wx.getUserProfile) {
      wx.getUserProfile({
        desc: '用于游戏显示',
        success: (res) => {
          const info = {
            name: res.userInfo.nickName,
            avatar: res.userInfo.avatarUrl,
          };
          wx.setStorageSync('userInfo', info);
          this.globalData.userInfo = info;
          callback(info);
        },
        fail: () => {
          this.globalData.userInfo = defaultUser;
          callback(defaultUser);
        }
      });
    } else {
      this.globalData.userInfo = defaultUser;
      callback(defaultUser);
    }
  },
  
  // 云数据库
  db: () => wx.cloud ? wx.cloud.database() : null,
});
