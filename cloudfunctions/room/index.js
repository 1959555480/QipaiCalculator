// cloudfunctions/room/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

// 获取用户信息
function getUserInfo(userId) {
  return db.collection('users').where({
    userId: userId
  }).get().then(res => res.data[0])
}

// 创建房间
async function createRoom(roomId, userInfo) {
  const creator = {
    id: userInfo.openid,
    name: userInfo.name,
    avatar: userInfo.avatar,
    openid: userInfo.openid,
    isOwner: true,
    score: 0,
    joinTime: db.serverDate()
  }
  
  await db.collection('rooms').doc(roomId).set({
    data: {
      roomId: roomId,
      allowJoin: true,
      players: [creator],
      history: [],
      createdAt: db.serverDate(),
      createdBy: userInfo.openid
    }
  })
  
  return { success: true, room: { roomId, allowJoin: true, players: [creator], history: [] } }
}

// 加入房间
async function joinRoom(roomId, userInfo) {
  const room = await db.collection('rooms').doc(roomId).get()
  
  if (!room.data) {
    return { success: false, error: '房间不存在' }
  }
  
  if (room.data.allowJoin === false) {
    return { success: false, error: '房主已关闭加入' }
  }
  
  const players = room.data.players || []
  const existing = players.find(p => p.openid === userInfo.openid)
  
  if (existing) {
    return { success: true, room: room.data }
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
  
  await db.collection('rooms').doc(roomId).update({
    data: { players: players }
  })
  
  room.data.players = players
  return { success: true, room: room.data }
}

// 更新房间（切换加入开关）
async function updateRoom(roomId, data, userInfo) {
  const room = await db.collection('rooms').doc(roomId).get()
  
  if (!room.data) {
    return { success: false, error: '房间不存在' }
  }
  
  if (room.data.createdBy !== userInfo.openid) {
    return { success: false, error: '只有房主可以操作' }
  }
  
  const updateData = {}
  if (data.allowJoin !== undefined) updateData.allowJoin = data.allowJoin
  if (data.players !== undefined) updateData.players = data.players
  if (data.history !== undefined) updateData.history = data.history
  updateData.updatedAt = db.serverDate()
  
  await db.collection('rooms').doc(roomId).update({ data: updateData })
  
  const updatedRoom = await db.collection('rooms').doc(roomId).get()
  return { success: true, room: updatedRoom.data }
}

// 获取房间
async function getRoom(roomId) {
  const room = await db.collection('rooms').doc(roomId).get()
  
  if (!room.data) {
    return { success: false, error: '房间不存在' }
  }
  
  return { success: true, room: room.data }
}

// 提交分数
async function submitScore(roomId, scoreData, userInfo) {
  const room = await db.collection('rooms').doc(roomId).get()
  
  if (!room.data) {
    return { success: false, error: '房间不存在' }
  }
  
  const players = room.data.players || []
  const history = room.data.history || []
  
  // 更新分数
  scoreData.forEach(s => {
    const player = players.find(p => p.openid === s.openid)
    if (player) {
      player.score = (player.score || 0) + s.delta
    }
  })
  
  // 添加历史记录
  const changeText = scoreData.map(s => {
    const player = players.find(p => p.openid === s.openid)
    if (player) {
      return `${player.name}: ${s.delta > 0 ? '+' : ''}${s.delta}`
    }
    return ''
  }).filter(Boolean).join(', ')
  
  history.push({
    changesText: changeText,
    time: new Date().toLocaleTimeString(),
    submitBy: userInfo.openid
  })
  
  await db.collection('rooms').doc(roomId).update({
    data: {
      players: players,
      history: history,
      updatedAt: db.serverDate()
    }
  })
  
  return { success: true }
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
    switch (action) {
      case 'create':
        return await createRoom(event.roomId, userInfo)
      
      case 'join':
        return await joinRoom(event.roomId, userInfo)
      
      case 'get':
        return await getRoom(event.roomId)
      
      case 'update':
        return await updateRoom(event.roomId, event.data, userInfo)
      
      case 'submitScore':
        return await submitScore(event.roomId, event.scores, userInfo)
      
      default:
        return { success: false, error: '未知操作' }
    }
  } catch (err) {
    return { success: false, error: err.message }
  }
}
