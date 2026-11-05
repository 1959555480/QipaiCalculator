// pages/index/index.js
const app = getApp()

const defaultAvatarUrl = 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0'

Page({
  data: {
    userInfo: null,
    avatarUrl: '',
    roomIdInput: '',
  },

  onLoad() {
    // 读取缓存的用户信息和头像
    const cachedUser = wx.getStorageSync('userInfo');
    const cachedAvatar = wx.getStorageSync('avatarUrl');
    
    this.setData({
      userInfo: cachedUser || null,
      avatarUrl: cachedAvatar || defaultAvatarUrl,
    });

    // 旧版本缓存的是本机临时路径（换设备/换人必然加载失败），进首页时自动补传到云存储
    if (cachedAvatar && !/^(cloud:\/\/|https:\/\/)/.test(cachedAvatar)) {
      this.uploadAvatar(cachedAvatar);
    }
    
    // 如果没有用户信息，用云函数登录
    if (!cachedUser || !cachedUser.name) {
      this.doLogin();
    }
  },

  // 登录获取用户（当没有缓存时）
  doLogin() {
    if (wx.cloud) {
      wx.cloud.callFunction({
        name: 'login',
        success: (res) => {
          if (res.result && res.result.openid) {
            const shortId = res.result.openid.slice(-6);
            const user = { name: '玩家' + shortId };
            wx.setStorageSync('userInfo', user);
            this.setData({ userInfo: user });
          }
        },
        fail: () => {
          const user = { name: '玩家' + Math.floor(Math.random() * 1000) };
          this.setData({ userInfo: user });
        }
      });
    }
  },

  // 选择头像
  onChooseAvatar(e) {
    const { avatarUrl } = e.detail
    this.setData({ avatarUrl })
    wx.setStorageSync('avatarUrl', avatarUrl)
    this.uploadAvatar(avatarUrl)
  },

  // 头像上传到云存储，换成 cloud:// 文件ID（本地临时路径换设备/换人就成了破图）
  uploadAvatar(tempPath) {
    if (!wx.cloud || !tempPath) return
    // 已经是云文件或网络地址，不需要上传
    if (tempPath.indexOf('cloud://') === 0 || tempPath.indexOf('https://') === 0) return
    // 只上传本机文件（开发者工具/安卓: http://tmp/，iOS: wxfile://，部分机型: http://usr/）
    if (!/^(wxfile:\/\/|https?:\/\/tmp\/|https?:\/\/usr\/)/.test(tempPath)) return

    const openid = app.globalData.openid || wx.getStorageSync('openid') || 'anonymous'
    const extMatch = tempPath.match(/\.([a-zA-Z0-9]+)(\?|$)/)
    const ext = extMatch ? extMatch[1] : 'png'
    const cloudPath = `avatars/${openid}_${Date.now()}.${ext}`

    wx.showLoading({ title: '上传头像...' })

    let resolveUpload
    const task = new Promise((resolve) => { resolveUpload = resolve })
    this.avatarUploading = task
    task.then(() => {
      if (this.avatarUploading === task) this.avatarUploading = null
    })

    try {
      wx.cloud.uploadFile({
        cloudPath,
        filePath: tempPath,
        success: (res) => {
          wx.hideLoading()
          if (res.fileID) {
            // 只有当前头像仍是这张临时图时才替换，避免连点产生竞态
            if (wx.getStorageSync('avatarUrl') === tempPath) {
              wx.setStorageSync('avatarUrl', res.fileID)
              this.setData({ avatarUrl: res.fileID })
            }
            const user = wx.getStorageSync('userInfo') || {}
            wx.setStorageSync('userInfo', { ...user, avatar: res.fileID })
          }
          resolveUpload()
        },
        fail: (err) => {
          wx.hideLoading()
          console.error('头像上传失败', err)
          wx.showToast({ title: '头像上传失败，请重新选择', icon: 'none' })
          resolveUpload()
        }
      })
    } catch (err) {
      wx.hideLoading()
      console.error('头像上传异常', err)
      resolveUpload()
    }
  },

  // 头像加载失败时退回默认头像
  onAvatarError() {
    this.setData({ avatarUrl: defaultAvatarUrl })
  },

  // 昵称失焦保存
  onNicknameBlur(e) {
    const name = e.detail.value.trim();
    if (name) {
      const user = { ...this.data.userInfo, name: name };
      wx.setStorageSync('userInfo', user);
      this.setData({ userInfo: user });
    }
  },

  // 昵称输入
  onNicknameInput(e) {
    this.setData({ 'userInfo.name': e.detail.value });
  },

  // 创建房间（房号由云函数生成，房间页负责真正创建）
  createRoom() {
    let userInfo = this.data.userInfo;
    if (!userInfo || !(userInfo.name || '').trim()) {
      // 还没填昵称时给个默认名，避免开房被阻断
      userInfo = { ...(userInfo || {}), name: '玩家' + Math.floor(1000 + Math.random() * 9000) };
      wx.setStorageSync('userInfo', userInfo);
      this.setData({ userInfo });
    }
    const goCreate = () => wx.navigateTo({
      url: '/pages/room/room?action=create',
    });

    // 头像可能还在上传，等它换成 cloud 文件ID 再进房，否则别人拿到的是本机临时路径
    if (this.avatarUploading) {
      wx.showLoading({ title: '头像处理中...' });
      this.avatarUploading.then(() => {
        wx.hideLoading();
        goCreate();
      });
      return;
    }

    goCreate();
  },

  // 扫码进房
  scanQRCode() {
    wx.scanCode({
      success: (res) => {
        const roomId = this.parseRoomId(res.result);
        if (!roomId) {
          wx.showToast({ title: '二维码无效', icon: 'none' });
          return;
        }
        wx.navigateTo({
          url: `/pages/room/room?roomId=${roomId}&action=join`,
        });
      },
      fail: () => {
        wx.showToast({ title: '取消扫描', icon: 'none' });
      }
    });
  },

  // 从扫码结果中取出四位房号（支持纯数字/带 roomId 参数的链接）
  parseRoomId(result) {
    const text = (result || '').trim();
    if (/^\d{4}$/.test(text)) return text;
    const matched = text.match(/[?&]roomId=(\d{4})/);
    return matched ? matched[1] : '';
  },

  // 输入房号
  onRoomIdInput(e) {
    const value = (e.detail.value || '').replace(/\D/g, '').slice(0, 4);
    this.setData({ roomIdInput: value });
    return value;
  },

  // 手动输入房号进房
  joinByRoomId() {
    const roomId = (this.data.roomIdInput || '').trim();
    if (!/^\d{4}$/.test(roomId)) {
      wx.showToast({ title: '请输入4位房号', icon: 'none' });
      return;
    }
    const goJoin = () => wx.navigateTo({
      url: `/pages/room/room?roomId=${roomId}&action=join`,
    });

    // 和开房一样，等头像上传完成再进房
    if (this.avatarUploading) {
      wx.showLoading({ title: '头像处理中...' });
      this.avatarUploading.then(() => {
        wx.hideLoading();
        goJoin();
      });
      return;
    }

    goJoin();
  },
});