// app.js
App({
  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({
        env: 'cloud1-6gd9msfpc3b53edf', // ⚠️ 填你的云环境ID
        traceUser: true,
      });
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
        openid = res.result.openid;
        wx.setStorageSync('openid', openid);
        this.globalData.openid = openid;
        callback(openid);
      } else {
        callback('user_' + Math.random().toString(36).substr(2, 9));
      }
    }).catch(() => {
      callback('user_' + Math.random().toString(36).substr(2, 9));
    });
  },
  
  // 获取用户信息
  getUserInfo(callback) {
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo) {
      this.globalData.userInfo = userInfo;
      callback(userInfo);
      return;
    }
    
    this.getUserId(() => {
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
          const info = { name: '我', avatar: '👤' };
          wx.setStorageSync('userInfo', info);
          this.globalData.userInfo = info;
          callback(info);
        }
      });
    });
  },
  
  // 云数据库
  db: () => wx.cloud ? wx.cloud.database() : null,
});
