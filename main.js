const MinecraftProtocol = require('minecraft-protocol');
const Crypto = require('crypto');
const Vec3 = require('vec3');
const Redis = require('redis');

(async () => {
    const DB = Redis.createClient({
        RDS_PORT: 6379,
        RDS_HOST: '127.0.0.1',
        RDS_OPTS: {
            auth_pass: ''
        }
    });
    await DB.connect();

    const server = MinecraftProtocol.createServer({
        'online-mode': false,
        encryption: true,
        host: '0.0.0.0',
        port: 50000,
        version: '1.17.1'
    });
    const MinecraftData = require('minecraft-data')(server.version);

    const Chunk = require('prismarine-chunk')(server.version);
    const chunk = new Chunk();
    chunk.setBlockType(new Vec3(0, 0, 0), MinecraftData.blocksByName.barrier.id);

    server.on('login', async (client) => {

        let user = { uuid: client.uuid, name: client.username, isLogin: false, client: client };
        let userData = await DB.get(user.uuid);
        if (userData !== null) {
            userData = JSON.parse(userData);
            user.isRegistered = true;
            user.password = userData.password;
            user.lastLoginTime = userData.lastLoginTime;
            user.ban = userData.ban;
            user.logincount = 0;
        } else {
            user.isRegistered = false;
            user.lastLoginTime = Date.now() + 60000;
            user.logincount = 0;
            user.ban = 0;
        }

        client.write('login', {
            entityId: client.id,
            isHardcore: false,
            gameMode: 0,
            previousGameMode: 0,
            worldNames: ['minecraft:the_end'],
            dimensionCodec: MinecraftData.loginPacket.dimensionCodec,
            dimension: {
                type: 'compound',
                name: '',
                value: {
                    piglin_safe: { type: 'byte', value: 0 },
                    natural: { type: 'byte', value: 1 },
                    ambient_light: { type: 'float', value: 0 },
                    infiniburn: { type: 'string', value: 'minecraft:infiniburn_the_end' },
                    respawn_anchor_works: { type: 'byte', value: 0 },
                    has_skylight: { type: 'byte', value: 1 },
                    bed_works: { type: 'byte', value: 1 },
                    effects: { type: 'string', value: 'minecraft:the_end' },
                    has_raids: { type: 'byte', value: 1 },
                    logical_height: { type: 'int', value: 256 },
                    coordinate_scale: { type: 'double', value: 1 },
                    min_y: { type: 'int', value: 0 },
                    has_ceiling: { type: 'byte', value: 0 },
                    ultrawarm: { type: 'byte', value: 0 },
                    height: { type: 'int', value: 256 }
                }
            },
            worldName: 'minecraft:the_end',
            hashedSeed: [0, 0],
            maxPlayers: server.maxPlayers,
            viewDistance: 10,
            reducedDebugInfo: false,
            enableRespawnScreen: true,
            isDebug: false,
            isFlat: false
        })

        client.on('end', (addr) => {
            console.log('断开连接', '(' + addr + ')')
        })

        client.on('error', (error) => {
            console.log('错误:', error)
        })

        client.write('map_chunk', {
            x: 0,
            z: 0,
            groundUp: true,
            biomes: chunk.dumpBiomes !== undefined ? chunk.dumpBiomes() : undefined,
            heightmaps: {
                type: 'compound',
                name: '',
                value: {}
            },
            bitMap: chunk.getMask(),
            chunkData: chunk.dump(),
            blockEntities: []
        })
        client.write('position', {
            x: 0.5,
            y: 1,
            z: 0.5
        })
        client.on('position', (x, y, z, onGround) => {
            if (x > 100 || x < -100 || y > 100 || y < -100 || z > 100 || z < -100) {
                client.write('position', {
                    x: 0.5,
                    y: 1,
                    z: 0.5
                })
            }
        })

        if (user.isRegistered) {
            if (Date.now() < user.ban) {
                client.end('登录过于频繁，请稍后再试!');
            } else {
                client.write('chat', {
                    message: JSON.stringify({
                        text: '[登录] 按"T"键打开聊天栏后，输入您的密码，按回车键提交。',
                        bold: true,
                        color: 'green',
                    }),
                    position: 1,
                    sender: '0'
                })
            }
            client.on('chat', (data) => {
                if (!user.isLogin) {
                    if (user.logincount < 5) {
                        if (Crypto.createHash('SHA256').update(data.message).digest('hex') == user.password) {
                            DB.set(user.uuid, JSON.stringify({
                                password: Crypto.createHash('SHA256').update(data.message).digest('hex'),
                                lastLoginTime: Date.now(),
                                ban: 0
                            }))
                            user.isLogin = true;
                            client.write('chat', {
                                message: JSON.stringify({
                                    text: '输入 /server 你想要去的服务器名称 即可传送。',
                                    bold: true,
                                    color: 'gold',
                                }),
                                position: 1,
                                sender: '0'
                            })
                        } else {
                            user.logincount++;
                            client.write('chat', {
                                message: JSON.stringify({
                                    text: '密码错误，请重新输入。',
                                    bold: true,
                                    color: 'red',
                                }),
                                position: 1,
                                sender: '0'
                            })
                        }
                    } else {
                        DB.set(user.uuid, JSON.stringify({
                            password: user.password,
                            lastLoginTime: Date.now(),
                            ban: Date.now()+60000
                        }))
                        client.end('密码错误次数过多，请稍后再试。');
                    }
                } else {
                    client.write('chat', {
                        message: JSON.stringify({
                            text: '输入 /server 你想要去的服务器名称 即可传送。',
                            bold: true,
                            color: 'gold',
                        }),
                        position: 1,
                        sender: '0'
                    })
                }
            })
        } else {
            client.write('chat', {
                message: JSON.stringify({
                    text: '[注册]按"T"键打开聊天栏后，输入您的密码，按回车键提交。',
                    bold: true,
                    color: 'blue',
                }),
                position: 1,
                sender: '0'
            })
            client.on('chat', (data) => {
                if (data.message.length < 6) {
                    client.write('chat', {
                        message: JSON.stringify({
                            text: '密码过短，请重新输入。',
                            bold: true,
                            color: 'red',
                        }),
                        position: 1,
                        sender: '0'
                    })
                } else {
                    DB.set(user.uuid, JSON.stringify({
                        password: Crypto.createHash('SHA256').update(data.message).digest('hex'),
                        lastLoginTime: Date.now(),
                        ban: 0
                    }))
                    client.end('注册成功，请重新登录。')
                }
            })
        }
    })
})();

