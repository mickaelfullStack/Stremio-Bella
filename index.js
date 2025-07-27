const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");

// SUA LISTA M3U (substitua pelo seu link)
const M3U_URL = "https://raw.githubusercontent.com/mickaelfullStack/BellaIptv/refs/heads/main/BellaIptv.m3u";

// Função para processar a lista M3U
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
                const groupMatch = line.match(/group-title="([^"]+)"/);
                
                currentChannel = {
                    name: nameMatch ? nameMatch[1] : "Canal Desconhecido",
                    logo: logoMatch ? logoMatch[1] : "",
                    group: groupMatch ? groupMatch[1] : "Outros",
                };
            } 
            else if (line.startsWith("http")) {
                if (currentChannel.name) {
                    channels.push({
                        id: currentChannel.name.toLowerCase().replace(/\s+/g, "-"),
                        name: currentChannel.name,
                        logo: currentChannel.logo,
                        group: currentChannel.group,
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
    version: "1.0.0",
    name: "Bella IPTV",
    description: "Add-on para a lista Bella IPTV",
    catalogs: [],
    resources: ["stream"],
    types: ["tv"],
});

// Manipulador de streams (canais)
builder.defineStreamHandler(async ({ type, id }) => {
    if (type !== "tv") return { streams: [] };
    
    const channels = await parseM3U();
    const channel = channels.find((c) => c.id === id);
    
    return { 
        streams: channel ? channel.streams : [] 
    };
});

module.exports = builder.getInterface();