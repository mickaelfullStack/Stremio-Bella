const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");
const express = require("express");
const cors = require("cors");

// Sua lista M3U (mantendo o link original)
const M3U_URL = "https://raw.githubusercontent.com/mickaelfullStack/BellaIptv/refs/heads/main/BellaIptv.m3u";

// Processa a lista M3U no formato específico do seu arquivo
async function parseM3U() {
    try {
        const response = await axios.get(M3U_URL);
        const m3uContent = response.data;
        const lines = m3uContent.split("\n");
        const channels = [];
        let currentChannel = {};

        for (const line of lines) {
            if (line.startsWith("#EXTINF")) {
                // Extrai informações específicas do seu formato
                const nameMatch = line.match(/tvg-name="BR\|([^"]*)"/) || line.match(/,BR\|([^$]*)/);
                const logoMatch = line.match(/tvg-logo="([^"]*)"/);
                const groupMatch = line.match(/group-title="([^"]*)"/);
                
                const channelName = nameMatch ? nameMatch[1].trim() : "Canal Desconhecido";
                
                currentChannel = {
                    id: channelName.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, ""),
                    name: channelName,
                    logo: logoMatch ? logoMatch[1] : "",
                    group: groupMatch ? groupMatch[1] : "Outros"
                };
            } else if (line.startsWith("http")) {
                if (currentChannel.name) {
                    channels.push({
                        ...currentChannel,
                        streams: [{ url: line.trim() }],
                    });
                }
            }
        }
        return channels;
    } catch (error) {
        console.error("Erro ao processar M3U:", error);
        return [];
    }
}

// Configuração do Add-on
const builder = new addonBuilder({
    id: "com.bellaiptv",
    version: "1.0.1",
    name: "Bella IPTV",
    description: "Add-on para a lista Bella IPTV (AM)",
    catalogs: [],
    resources: ["stream"],
    types: ["tv"],
    idPrefixes: ["br"]
});

// Define como o Stremio busca os streams
builder.defineStreamHandler(async ({ type, id }) => {
    if (type !== "tv") return { streams: [] };
    
    const channels = await parseM3U();
    const channel = channels.find((c) => c.id === id);
    
    if (!channel) {
        console.log("Canal não encontrado:", id);
        return { streams: [] };
    }
    
    return { 
        streams: channel.streams.map(stream => ({
            ...stream,
            name: channel.name,
            title: channel.name,
            behaviorHints: {
                notWebReady: true,
                bingeGroup: `BellaIPTV-${channel.group}`
            }
        })),
        cacheMaxAge: 60*60*4 // Cache de 4 horas
    };
});

const addonInterface = builder.getInterface();

// Cria um servidor web com Express
const app = express();
app.use(cors());

// Rota do manifest
app.get("/manifest.json", (_, res) => {
    res.setHeader("Content-Type", "application/json");
    res.json(addonInterface.manifest);
});

// Rota dos streams
app.get("/stream/:type/:id.json", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    
    if (req.params.type !== "tv") {
        return res.status(400).json({ error: "Tipo de recurso inválido" });
    }

    addonInterface.stream(req.params.type, req.params.id)
        .then((data) => {
            if (!data.streams || data.streams.length === 0) {
                console.log("Nenhum stream encontrado para:", req.params.id);
            }
            res.json(data);
        })
        .catch((err) => {
            console.error("Erro ao processar requisição:", err);
            res.status(500).json({ error: "Erro interno do servidor" });
        });
});

// Rota para listar todos os canais (útil para debug)
app.get("/channels", async (_, res) => {
    try {
        const channels = await parseM3U();
        res.json(channels);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Inicia o servidor
const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
    console.log(`✅ Add-on rodando em: http://localhost:${PORT}/manifest.json`);
    console.log(`🔍 Debug de canais disponível em: http://localhost:${PORT}/channels`);
});