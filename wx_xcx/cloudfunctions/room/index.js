// cloudfunctions/room/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

// 头像临时链接缓存：fileID -> { url, expireAt }（临时链接有效期约 2 小时）
const avatarUrlCache = {}
const AVATAR_URL_TTL = 100 * 60 * 1000

// 用云函数的管理端权限换取头像临时链接，避免云存储「仅创建者可读」时别人看不到头像
async function resolveAvatarUrls(players) {
  const now = Date.now()
  const fileList = []

  ;(players || []).forEach(p => {
    const avatar = p.avatar || ''
    if (avatar.indexOf('cloud://') !== 0) return
    const cached = avatarUrlCache[avatar]
    if ((!cached || cached.expireAt <= now) && fileList.indexOf(avatar) < 0) {
      fileList.push(avatar)
    }
  })

  if (fileList.length) {
    try {
      const res = await cloud.getTempFileURL({ fileList: fileList })
      ;(res.fileList || []).forEach(f => {
        if (f.fileID && f.tempFileURL) {
          avatarUrlCache[f.fileID] = {
            url: f.tempFileURL,
            expireAt: Date.now() + AVATAR_URL_TTL
          }
        } else {
          console.warn('头像临时链接获取失败', f.fileID, f.status, f.errMsg)
        }
      })
    } catch (err) {
      console.error('头像临时链接获取异常', err)
    }
  }

  const urls = {}
  ;(players || []).forEach(p => {
    const cached = avatarUrlCache[p.avatar || '']
    if (cached && cached.url) urls[p.avatar] = cached.url
  })
  return urls
}

// 创建房间 - 生成四位数字ID
async function createRoom(userInfo) {
  // 生成四位随机数字房间号
  const roomId = Math.floor(1000 + Math.random() * 9000).toString()
  
  // 检查是否已存在
  const existing = await db.collection('rooms').where({
    roomId: roomId
  }).get()
  
  if (existing.data && existing.data.length > 0) {
    return { success: false, error: '房间号冲突，请重试' }
  }
  
  const creator = {
    id: userInfo.openid,
    name: userInfo.name,
    avatar: userInfo.avatar,
    openid: userInfo.openid,
    isOwner: true,
    score: 0,
    joinTime: db.serverDate()
  }
  
  await db.collection('rooms').add({
    data: {
      roomId: roomId,
      allowJoin: true,
      players: [creator],
      history: [],
      createdAt: db.serverDate(),
      createdBy: userInfo.openid
    }
  })
  
  // 回读一次，返回真实入库文档（避免把 serverDate 对象直接序列化给客户端）
  const created = await db.collection('rooms').where({ roomId: roomId }).get()
  const room = created.data && created.data[0]
    ? created.data[0]
    : { roomId, allowJoin: true, players: [creator], history: [] }
  
  return { success: true, roomId: roomId, room: room }
}

// 加入房间 - 用 roomId 字段查询
async function joinRoom(roomId, userInfo) {
  const rooms = await db.collection('rooms').where({
    roomId: roomId
  }).get()
  
  if (!rooms.data || rooms.data.length === 0) {
    return { success: false, error: '房间不存在' }
  }
  
  const room = rooms.data[0]
  
  if (room.allowJoin === false) {
    return { success: false, error: '房主已关闭加入' }
  }
  
  const players = room.players || []
  const existing = players.find(p => p.openid === userInfo.openid)
  
  if (existing) {
    // 昵称/头像可能在本地改过，重新进房时同步（只接受云文件/网络头像，避免把本机临时路径写进云端）
    const newName = userInfo.name && userInfo.name !== '我' && userInfo.name !== '点击授权' ? userInfo.name : ''
    const newAvatar = /^(https:\/\/|cloud:\/\/)/.test(userInfo.avatar || '') ? userInfo.avatar : ''
    const nameChanged = !!newName && existing.name !== newName
    const avatarChanged = !!newAvatar && existing.avatar !== newAvatar
    
    if (nameChanged || avatarChanged) {
      if (nameChanged) existing.name = newName
      if (avatarChanged) existing.avatar = newAvatar
      await db.collection('rooms').doc(room._id).update({
        data: { players: players }
      })
    }
    
    return { success: true, room: room }
  }
  
  const newPlayer = {
    id: userInfo.openid,
    name: userInfo.name,
    avatar: userInfo.avatar,
    openid: userInfo.openid,
    isOwner: false,
    score: 0,
    joinTime: db.serverDate()
  }
  
  players.push(newPlayer)
  
  await db.collection('rooms').doc(room._id).update({
    data: { players: players }
  })
  
  room.players = players
  return { success: true, room: room }
}

// 退出房间 - 移除自己；房主退出时把房主身份移交给下一位
async function leaveRoom(roomId, userInfo) {
  const rooms = await db.collection('rooms').where({
    roomId: roomId
  }).get()
  
  if (!rooms.data || rooms.data.length === 0) {
    return { success: false, error: '房间不存在' }
  }
  
  const room = rooms.data[0]
  const players = room.players || []
  const index = players.findIndex(p => p.openid === userInfo.openid)
  
  // 已经不在房间里，直接返回当前状态
  if (index === -1) {
    return { success: true, room: room, left: false }
  }
  
  const isOwner = players[index].isOwner === true || room.createdBy === userInfo.openid
  players.splice(index, 1)
  
  // 最后一个人退出，房间直接删除
  if (players.length === 0) {
    await db.collection('rooms').doc(room._id).remove()
    return { success: true, dissolved: true, left: true }
  }
  
  if (isOwner) {
    players[0].isOwner = true
  }
  
  const updateData = {
    players: players,
    updatedAt: db.serverDate()
  }
  if (isOwner) {
    updateData.createdBy = players[0].openid
  }
  
  await db.collection('rooms').doc(room._id).update({ data: updateData })
  
  const updatedRooms = await db.collection('rooms').where({ roomId: roomId }).get()
  return { success: true, room: updatedRooms.data[0], left: true, transferred: isOwner }
}

// 更新房间
async function updateRoom(roomId, data, userInfo) {
  const rooms = await db.collection('rooms').where({
    roomId: roomId
  }).get()
  
  if (!rooms.data || rooms.data.length === 0) {
    return { success: false, error: '房间不存在' }
  }
  
  const room = rooms.data[0]
  
  if (room.createdBy !== userInfo.openid) {
    return { success: false, error: '只有房主可以操作' }
  }
  
  const updateData = {}
  if (data.allowJoin !== undefined) updateData.allowJoin = data.allowJoin
  if (data.players !== undefined) updateData.players = data.players
  if (data.history !== undefined) updateData.history = data.history
  updateData.updatedAt = db.serverDate()
  
  await db.collection('rooms').doc(room._id).update({ data: updateData })
  
  const updatedRooms = await db.collection('rooms').where({ roomId: roomId }).get()
  return { success: true, room: updatedRooms.data[0] }
}

// 获取房间
async function getRoom(roomId) {
  const rooms = await db.collection('rooms').where({
    roomId: roomId
  }).get()
  
  if (!rooms.data || rooms.data.length === 0) {
    return { success: false, error: '房间不存在' }
  }
  
  return { success: true, room: rooms.data[0] }
}

// 提交分数：给别人加分的同时，自己扣除相同的分数（可为负数）
async function submitScore(roomId, scoreData, userInfo) {
  const rooms = await db.collection('rooms').where({
    roomId: roomId
  }).get()
  
  if (!rooms.data || rooms.data.length === 0) {
    return { success: false, error: '房间不存在' }
  }
  
  const room = rooms.data[0]
  const players = room.players || []
  const history = room.history || []
  const giver = players.find(p => p.openid === userInfo.openid)
  
  if (!giver) {
    return { success: false, error: '你不在这个房间' }
  }
  
  const list = Array.isArray(scoreData) ? scoreData : []
  const changes = []
  let total = 0
  
  // 更新被记分人的分数
  list.forEach(s => {
    const delta = Number(s.delta) || 0
    const player = players.find(p => p.openid === s.openid)
    
    // 只能给别人加分，且必须是正整数
    if (!player || delta <= 0) return
    if (player.openid === userInfo.openid) return
    
    player.score = (player.score || 0) + delta
    total += delta
    changes.push(`${player.name}: +${delta}`)
  })
  
  if (total === 0) {
    return { success: false, error: '没有可提交的分数' }
  }
  
  // 给别人加分 = 自己扣同样的分，可以扣成负数
  giver.score = (giver.score || 0) - total
  changes.push(`${giver.name}: -${total}`)
  
  // 添加历史记录
  history.push({
    changesText: changes.join('，'),
    time: new Date().toLocaleTimeString(),
    submitBy: userInfo.openid
  })
  
  await db.collection('rooms').doc(room._id).update({
    data: {
      players: players,
      history: history,
      updatedAt: db.serverDate()
    }
  })
  
  return { success: true, total: total, giverScore: giver.score }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  
  const userInfo = {
    openid: wxContext.OPENID,
    name: event.name || '我',
    avatar: event.avatar || '👤'
  }
  
  const action = event.action
  
  try {
    let result
    
    switch (action) {
      case 'create':
        result = await createRoom(userInfo)
        break
      
      case 'join':
        result = await joinRoom(event.roomId, userInfo)
        break
      
      case 'leave':
        result = await leaveRoom(event.roomId, userInfo)
        break
      
      case 'get':
        result = await getRoom(event.roomId)
        break
      
      case 'update':
        result = await updateRoom(event.roomId, event.data, userInfo)
        break
      
      case 'submitScore':
        result = await submitScore(event.roomId, event.scores, userInfo)
        break
      
      default:
        result = { success: false, error: '未知操作' }
    }
    
    // 统一回传调用者 openid，客户端据此判断"自己"
    result = { ...result, openid: userInfo.openid }

    // 用云函数管理端权限换取头像临时链接，云存储权限严格时客户端也能显示
    if (result.room && result.room.players) {
      const avatarUrls = await resolveAvatarUrls(result.room.players)
      if (Object.keys(avatarUrls).length) {
        result.avatarUrls = avatarUrls
      }
    }

    return result
  } catch (err) {
    return { success: false, error: err.message, openid: userInfo.openid }
  }
}
