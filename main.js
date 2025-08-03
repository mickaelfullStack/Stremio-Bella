const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");
const express = require("express");
const cors = require("cors");

// URL da lista M3U
const M3U_URL = "https://raw.githubusercontent.com/mickaelfullStack/BellaIptv/refs/heads/main/BellaIptv.m3u";

// Processa a lista M3U
async function parseM3U() {
    try {
        const response = await axios.get(M3U_URL);
        const m3uContent = response.data;
        const lines = m3uContent.split("\n");
        const channels = [];
        let currentChannel = {};
        let currentGroup = "Geral"; // Grupo padrão

        for (const line of lines) {
            // Detecta grupos de canais
            if (line.startsWith("#EXTGRP:")) {
                currentGroup = line.replace("#EXTGRP:", "").trim();
                continue;
            }

            // Processa informações do canal
            if (line.startsWith("#EXTINF")) {
                const info = {
                    name: "",
                    logo: "",
                    group: currentGroup,
                    id: "",
                    url: ""
                };

                // Extrai o nome do canal
                const nameMatch1 = line.match(/tvg-name="([^"]*)"/);
                const nameMatch2 = line.match(/,(.*)$/);
                
                if (nameMatch1) {
                    info.name = nameMatch1[1].replace("BR|", "").trim();
                } else if (nameMatch2) {
                    info.name = nameMatch2[1].replace("BR|", "").trim();
                }

                // Extrai o logo
                const logoMatch = line.match(/tvg-logo="([^"]*)"/);
                if (logoMatch) {
                    info.logo = logoMatch[1];
                }

                // Extrai o grupo se estiver na linha EXTINF
                const groupMatch = line.match(/group-title="([^"]*)"/);
                if (groupMatch) {
                    info.group = groupMatch[1];
                }

                // Cria um ID único
                info.id = info.name.toLowerCase()
                    .replace(/\s+/g, "-")
                    .replace(/[^\w-]/g, "");

                currentChannel = info;
            } 
            // Captura a URL do stream
            else if (line.startsWith("http")) {
                if (currentChannel.name) {
                    currentChannel.url = line.trim();
                    channels.push({...currentChannel});
                    currentChannel = {};
                }
            }
        }

        // Filtra canais válidos e remove duplicados
        const uniqueChannels = channels.reduce((acc, current) => {
            const x = acc.find(item => item.id === current.id);
            if (!x) {
                return acc.concat([current]);
            } else {
                return acc;
            }
        }, []).filter(ch => ch.name && ch.url);

        return uniqueChannels;
    } catch (error) {
        console.error("Erro ao processar M3U:", error);
        return [];
    }
}

// Configuração do Add-on
const builder = new addonBuilder({
    id: "com.bellaiptv",
    version: "1.0.3",
    name: "Bella IPTV",
    description: "Add-on para a lista Bella IPTV com filtros por grupo",
    catalogs: [],
    resources: ["stream"],
    types: ["tv"],
    idPrefixes: ["br"],
    logo: "https://i.imgur.com/5qYNd6Q.png",
    background: "https://i.imgur.com/5qYNd6Q.png"
});

// Cache para os canais e grupos
let channelsCache = [];
let groupsCache = new Set();
let lastCacheUpdate = 0;
const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 horas

// Atualiza o cache
async function updateCache() {
    try {
        const startTime = Date.now();
        channelsCache = await parseM3U();
        
        // Atualiza lista de grupos
        groupsCache = new Set();
        channelsCache.forEach(channel => {
            if (channel.group) {
                groupsCache.add(channel.group);
            }
        });
        
        lastCacheUpdate = Date.now();
        console.log(`✅ Cache atualizado com ${channelsCache.length} canais e ${groupsCache.size} grupos (${Date.now() - startTime}ms)`);
    } catch (error) {
        console.error("Erro ao atualizar cache:", error);
    }
}

// Handler para buscar streams
builder.defineStreamHandler(async ({ type, id }) => {
    if (type !== "tv") return { streams: [] };
    
    // Atualiza cache se expirado
    if (Date.now() - lastCacheUpdate > CACHE_TTL) {
        await updateCache();
    }
    
    const channel = channelsCache.find((c) => c.id === id);
    
    if (!channel) {
        console.log("Canal não encontrado:", id);
        return { streams: [] };
    }
    
    return { 
        streams: [{
            url: channel.url,
            name: channel.name,
            title: channel.name,
            behaviorHints: {
                notWebReady: true,
                bingeGroup: `BellaIPTV-${channel.group}`
            }
        }],
        cacheMaxAge: CACHE_TTL / 1000
    };
});

const addonInterface = builder.getInterface();

// Servidor Express
const app = express();
app.use(cors());

// Middleware de log
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Rota do manifest
app.get("/manifest.json", (_, res) => {
    res.setHeader("Content-Type", "application/json");
    res.json(addonInterface.manifest);
});

// Rota dos streams
app.get("/stream/:type/:id.json", async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    
    if (req.params.type !== "tv") {
        return res.status(400).json({ error: "Tipo de recurso inválido" });
    }

    try {
        const data = await addonInterface.stream(req.params.type, req.params.id);
        if (!data.streams || data.streams.length === 0) {
            console.log("Nenhum stream encontrado para:", req.params.id);
        }
        res.json(data);
    } catch (err) {
        console.error("Erro ao processar requisição:", err);
        res.status(500).json({ error: "Erro interno do servidor" });
    }
});

// Rota para listar todos os canais
app.get("/channels", async (req, res) => {
    try {
        if (Date.now() - lastCacheUpdate > CACHE_TTL) {
            await updateCache();
        }
        
        // Filtro por grupo se fornecido
        const group = req.query.group;
        let filteredChannels = channelsCache;
        
        if (group) {
            filteredChannels = channelsCache.filter(ch => ch.group === group);
        }
        
        res.json({
            count: filteredChannels.length,
            lastUpdated: new Date(lastCacheUpdate).toISOString(),
            channels: filteredChannels
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Nova rota para listar todos os grupos
app.get("/groups", async (_, res) => {
    try {
        if (Date.now() - lastCacheUpdate > CACHE_TTL) {
            await updateCache();
        }
        
        res.json({
            count: groupsCache.size,
            lastUpdated: new Date(lastCacheUpdate).toISOString(),
            groups: Array.from(groupsCache).sort()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rota para canais de um grupo específico
app.get("/groups/:groupName", async (req, res) => {
    try {
        if (Date.now() - lastCacheUpdate > CACHE_TTL) {
            await updateCache();
        }
        
        const groupChannels = channelsCache.filter(ch => ch.group === req.params.groupName);
        
        res.json({
            group: req.params.groupName,
            count: groupChannels.length,
            channels: groupChannels
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rota de saúde
app.get("/health", (_, res) => {
    res.json({
        status: "OK",
        channelsLoaded: channelsCache.length,
        groupsLoaded: groupsCache.size,
        lastCacheUpdate: new Date(lastCacheUpdate).toISOString(),
        uptime: process.uptime()
    });
});

// Tratamento de erros global
app.use((err, req, res, next) => {
    console.error("Erro não tratado:", err);
    res.status(500).json({ error: "Ocorreu um erro interno" });
});

// Inicia o servidor
const PORT = process.env.PORT || 7000;
app.listen(PORT, async () => {
    console.log(`✅ Add-on rodando em: http://localhost:${PORT}/manifest.json`);
    console.log(`📺 Canais: http://localhost:${PORT}/channels`);
    console.log(`🏷️ Grupos: http://localhost:${PORT}/groups`);
    console.log(`🩺 Health check: http://localhost:${PORT}/health`);
    
    await updateCache();
    setInterval(updateCache, CACHE_TTL);
});