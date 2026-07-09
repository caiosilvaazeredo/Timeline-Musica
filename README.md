# Vitrola

Jogo de festa multiplayer de linha do tempo musical (inspirado no classico Hitster) para jogar na sala: a TV e o palco (audio, QR code, placar) e cada jogador usa o proprio celular como controle, no estilo Kahoot. Ate 8 jogadores simultaneos.

## Como comecar

Ao abrir `/tv`, o host escolhe entre:

- **Festa Rapida**: brasileiras + internacionais, sem login e sem configuracao. Preset equilibrado (Original, meta 8, trecho de 30s via Deezer) com o QR na tela em segundos.
- **Festa Brasileira**: mesmo preset, so com musicas brasileiras.
- **Sala Personalizada**: o painel completo de modo, fonte de musica, repertorio e regras.

Em qualquer um dos dois, a sala pode ser **privada** (so quem tem o codigo entra) ou **publica** (aparece na lista de salas abertas da pagina inicial, estilo Gartic, para qualquer visitante entrar sem digitar codigo). O host alterna isso a qualquer momento no lobby pelo botao de visibilidade.

O QR code e o atalho de entrada usam sempre a URL real que a TV esta servindo naquele momento (nunca localhost por variavel de ambiente esquecida); um dominio curto customizado via `JOIN_URL` e opcional, para quem quiser o modelo kahoot.it/kahoot.com com dois enderecos.

## Como funciona

1. Abra `/tv` na TV (navegador da smart TV, Chromecast, notebook no HDMI). A sala e criada automaticamente com codigo e QR code.
2. O host configura a partida na propria TV: modo, meta, fichas, fonte de musica e filtros de repertorio.
3. Os jogadores escaneiam o QR code com o celular, escolhem nome e avatar e entram no lobby.
4. Ao iniciar, cada jogador recebe uma carta inicial. A cada rodada a TV fica preta com o vinil dourado girando enquanto o trecho toca.
5. O jogador da vez posiciona a carta na propria linha do tempo pelo celular, sem cronometro por padrao: apos 15 segundos, qualquer outro jogador pode acionar um cronometro de 30s (minimo garantido de 45s para pensar). Se ele arriscar artista e musica, a musica e cortada na hora e o palpite dele aparece na TV para todos.
6. Depois que ele joga, o botao CONTESTAR libera para os demais por 30 segundos.
7. Quem contesta gasta 1 ficha e e obrigado a posicionar a carta na propria linha. Ate N jogadores podem contestar a mesma carta (configuravel). Cliques simultaneos (janela de 400ms) vao a sorteio, e a ordem define quem tem prioridade sobre a carta.
8. Durante a rodada a TV exibe a linha do tempo do jogador da vez, e a carta misteriosa pulsa no intervalo que ele escolheu assim que posiciona: toda a sala acompanha a jogada.
9. Na revelacao a TV mostra ano, musica, interprete mais conhecido e autor original. Acertar a musica rende +1 ficha e acertar o artista/autor rende +1 ficha (ate 2 por rodada). A comparacao e tolerante a erros de escrita: "bohemian rapsody", "quen" ou so "jobim" contam como acerto.
10. Apos a revelacao, quem inicia a proxima rodada e o proprio proximo jogador, pelo celular; a TV exibe "Aguardando X iniciar a proxima rodada" (o host mantem um botao de forcar, se precisar).
11. O revezamento de turnos segue a ordem fixa de entrada na sala: contestar ou vencer cartas nunca muda de quem e a proxima vez. Se uma faixa falhar na reproducao, o servidor troca por outra do baralho silenciosamente.
12. Vence quem atingir a meta de cartas (padrao 10).

## Modos

| Modo | Para manter a carta |
|---|---|
| Original | Acertar a posicao |
| PRO | Posicao + artista + musica (5 fichas iniciais) |
| Expert | PRO + ano exato |
| Equipes | Regras do Original com linha do tempo e fichas compartilhadas |

## Fontes de musica

| Fonte | Login | Requisito |
|---|---|---|
| Trecho 30s (Deezer) | Nenhum | Nenhum, funciona de imediato |
| Spotify | Conta Premium de um jogador (OAuth na TV) | `SPOTIFY_CLIENT_ID` e `SPOTIFY_CLIENT_SECRET` |
| YouTube | Nenhum | `YT_API_KEY` (YouTube Data API v3) |

O servidor resolve a faixa em tempo de execucao (busca por artista + titulo na API escolhida) e entrega para a TV apenas a informacao de reproducao, sem revelar os metadados antes da hora.

## Repertorio e filtros

- Origem: somente brasileiras, somente internacionais, ou ambas
- Somente musicas que ja estiveram na Billboard Hot 100 (EUA)
- Somente musicas que ja estiveram no Top 100 Brasil
- Faixa de decadas (de/ate)
- Duracao do trecho, numero de fichas, meta de cartas e limite de contestacoes por carta

O banco curado esta em `data/songs.json` com titulo, interprete mais conhecido, autor original (compositor), ano e flags de filtro. Para expandir em direcao a 10 mil musicas:

```bash
npm run import:deezer                 # playlists padrao (por decada, BR, sertanejo, funk, MPB...)
node scripts/import-deezer.js 908622995 1111143121   # ou IDs de playlists do Deezer a sua escolha
```

O resultado vai para `data/songs-extra.json` e e mesclado automaticamente no proximo start. Observacao: a API publica do Deezer nao expoe compositor, entao nas faixas importadas o autor original fica igual ao interprete ate ser editado manualmente; o banco curado tem prioridade na deduplicacao.

## Rodando localmente

```bash
npm install
npm start
# TV:      http://localhost:3000/tv
# Jogador: http://localhost:3000/play?sala=CODIGO
```

Para testar com celulares na mesma rede, defina `BASE_URL=http://SEU_IP_LOCAL:3000` para o QR code apontar para o IP correto.

## Colocando online (modelo kahoot.it / kahoot.com)

O jogo e um servico web unico: depois do deploy, a TV abre `https://SEU-APP.onrender.com/tv` e os jogadores entram de qualquer lugar (Wi-Fi, 4G, outra cidade) pelo QR code, pelo atalho `https://SEU-APP.onrender.com/CODIGO` ou digitando o codigo na pagina inicial. Nada roda em localhost em producao; o localhost e apenas para desenvolvimento.

Para replicar o par kahoot.com/kahoot.it, use a variavel `JOIN_URL` com um dominio curto proprio (ex: `https://vitrola.page`) apontado para o mesmo servico no Render (Settings > Custom Domains). O QR code e a instrucao na TV passam a exibir o dominio curto, enquanto o host continua usando o principal.

## Deploy no Render

1. Suba o projeto para um repositorio no GitHub.
2. No Render: New > Blueprint e aponte para o repositorio (o `render.yaml` ja esta pronto). Ou crie um Web Service Node com build `npm install` e start `npm start`.
3. Configure as variaveis de ambiente:
   - `BASE_URL`: a URL publica do servico (ex: `https://vitrola.onrender.com`)
   - `JOIN_URL`: opcional, dominio curto de entrada dos jogadores (padrao: BASE_URL)
   - `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET`: opcionais, para a fonte Spotify
   - `YT_API_KEY`: opcional, para a fonte YouTube
4. Se usar Spotify, cadastre no dashboard do Spotify o Redirect URI: `{BASE_URL}/auth/spotify/callback`.

No plano gratuito do Render o servico hiberna apos inatividade e o estado das salas vive em memoria: salas ativas sao perdidas em restart/deploy. Para partidas caseiras isso e suficiente; para persistencia, o proximo passo natural e mover o estado para Redis.

## Notas tecnicas

- Node 18+, Express, Socket.io. Sem build step, frontend em HTML/CSS/JS puro.
- Reconexao: jogador que atualizar a pagina volta para a mesma vaga (token em localStorage); a TV recupera a sala apos refresh (sessionStorage) e a sala sobrevive 5 minutos sem TV.
- Spotify usa o Web Playback SDK (exige Premium). YouTube usa o IFrame Player com o video oculto atras do overlay do vinil.
- Autoplay: navegadores exigem um clique na TV antes do primeiro audio; a interface avisa quando necessario.
