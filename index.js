const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");
const express = require("express");

// Sua lista M3U
const M3U_URL = "https://raw.githubusercontent.com/mickaelfullStack/BellaIptv/refs/heads/main/BellaIptv.m3u";

// Processa a lista M3U e retorna os canais
async function parseM3U() {
    try {
        const response = await axios.get(M3U_URL);
        const m3uContent = response.data;
        const lines = m3uContent.split("\n");
        const channels = [];
        let currentChannel = {};

        for (const line of lines) {
            if (line.startsWith("#EXTINF")) {
                const nameMatch = line.match(/tvg-name="([^"]+)"/);
                const logoMatch = line.match(/tvg-logo="([^"]+)"/);
                currentChannel = {
                    id: nameMatch ? nameMatch[1].toLowerCase().replace(/\s+/g, "-") : "unknown",
                    name: nameMatch ? nameMatch[1] : "Canal Desconhecido",
                    logo: logoMatch ? logoMatch[1] : "",
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

// Configuração do Add-on (usando seu manifest.json)
const builder = new addonBuilder({
    id: "com.bellaiptv",
    version: "1.0.0",
    name: "Bella IPTV",
    description: "Add-on para a lista Bella IPTV",
    catalogs: [],
    resources: ["stream"],
    types: ["tv"],
});

// Define como o Stremio busca os streams
builder.defineStreamHandler(async ({ type, id }) => {
    const channels = await parseM3U();
    const channel = channels.find((c) => c.id === id);
    return { streams: channel ? channel.streams : [] };
});

const addonInterface = builder.getInterface();

// Cria um servidor web com Express
const app = express();
app.get("/manifest.json", (_, res) => res.json(addonInterface.manifest));
app.get("/stream/:type/:id.json", (req, res) => {
    addonInterface.stream[req.params.type](req.params.id)
        .then((data) => res.json(data))
        .catch((err) => res.status(500).send(err.message));
});

// Inicia o servidor na porta 7000
const PORT = 7000;
app.listen(PORT, () => {
    console.log(`✅ Add-on rodando em: http://localhost:${PORT}/manifest.json`);
});