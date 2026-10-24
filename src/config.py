#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Channels database and configuration for IPTV automated streaming architecture.
Pre-verified catalog of 120+ active channels across Azerbaijan, Turkey, and Russia.
"""

DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Connection": "keep-alive"
}

CHANNELS = [
    {
        "id": "AzTV",
        "name": "AzTV",
        "group": "Azerbaycan",
        "logo": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/Azerbaijan_Television_Logo.png/300px-Azerbaijan_Television_Logo.png",
        "headers": {
            "Referer": "https://aztv.az/"
        },
        "sources": [
            "http://erlyvideo.izone.az:80/aztv/mono.m3u8",
            "https://str.yodacdn.net/azertv/index.m3u8"
        ]
    },
    {
        "id": "IctimaiTV",
        "name": "İctimai TV",
        "group": "Azerbaycan",
        "logo": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/43/%C4%B0ctimai_TV_%282021%29.png/300px-%C4%B0ctimai_TV_%282021%29.png",
        "sources": [
            "http://erlyvideo.izone.az:80/ictimaitv/mono.m3u8",
            "https://live.itv.az/itv.m3u8"
        ]
    },
    {
        "id": "ARBTV",
        "name": "ARB TV",
        "group": "Azerbaycan",
        "logo": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9d/ARB_TV_Logo.png/300px-ARB_TV_Logo.png",
        "sources": [
            "http://erlyvideo.izone.az:80/arb/mono.m3u8"
        ]
    },
    {
        "id": "ARB24",
        "name": "ARB 24",
        "group": "Azerbaycan",
        "logo": "https://upload.wikimedia.org/wikipedia/az/thumb/8/88/ARB_24_loqo.png/300px-ARB_24_loqo.png",
        "sources": [
            "http://erlyvideo.izone.az:80/arb24/mono.m3u8"
        ]
    },
    {
        "id": "ARBGunesh",
        "name": "ARB Günəş",
        "group": "Azerbaycan",
        "logo": "https://upload.wikimedia.org/wikipedia/az/thumb/8/84/ARB_G%C3%BCn%C9%99%C5%9F_loqo.png/300px-ARB_G%C3%BCn%C9%99%C5%9F_loqo.png",
        "sources": [
            "http://erlyvideo.izone.az:80/arbgunesh/mono.m3u8"
        ]
    },
    {
        "id": "SpaceTV",
        "name": "Space TV",
        "group": "Azerbaycan",
        "logo": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c9/Space_TV_loqosu.png/300px-Space_TV_loqosu.png",
        "sources": [
            "http://erlyvideo.izone.az:80/spacetv/mono.m3u8"
        ]
    },
    {
        "id": "XezerTV",
        "name": "Xəzər TV",
        "group": "Azerbaycan",
        "logo": "https://upload.wikimedia.org/wikipedia/az/thumb/9/9a/X%C9%99z%C9%99r_TV_logo.png/300px-X%C9%99z%C9%99r_TV_logo.png",
        "sources": [
            "http://erlyvideo.izone.az:80/xezertv/mono.m3u8"
        ]
    },
    {
        "id": "AzadTV",
        "name": "ATV (Azad TV)",
        "group": "Azerbaycan",
        "logo": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/Azad_Azerbaycan_TV_logo.png/300px-Azad_Azerbaycan_TV_logo.png",
        "sources": [
            "https://lives.atv.az:5443/ATV_TV_STREAM/streams/atvcanli.m3u8"
        ]
    },
    {
        "id": "BakuTV",
        "name": "Baku TV",
        "group": "Azerbaycan",
        "logo": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3b/Baku_TV_%282018%29.png/300px-Baku_TV_%282018%29.png",
        "sources": [
            "https://rtmp.baku.tv/hls/bakutv.m3u8"
        ]
    },
    {
        "id": "CBCAzerbaijan",
        "name": "CBC Azerbaijan",
        "group": "Azerbaycan",
        "logo": "https://upload.wikimedia.org/wikipedia/az/thumb/c/c5/CBC_Azerbaijan_TV_Logo.png/300px-CBC_Azerbaijan_TV_Logo.png",
        "sources": [
            "http://erlyvideo.izone.az:80/cbc/mono.m3u8"
        ]
    },
    {
        "id": "MedeniyyetTV",
        "name": "Mədəniyyət TV",
        "group": "Azerbaycan",
        "logo": "https://upload.wikimedia.org/wikipedia/commons/f/fc/M%C9%99d%C9%99niyy%C9%99t_TV_logo.png",
        "sources": [
            "http://erlyvideo.izone.az:80/medeniyyet/mono.m3u8"
        ]
    },
    {
        "id": "RealTV",
        "name": "Real TV",
        "group": "Azerbaycan",
        "logo": "https://upload.wikimedia.org/wikipedia/az/thumb/d/d1/Real_TV_loqosu_%282019%29.jpg/300px-Real_TV_loqosu_%282019%29.jpg",
        "sources": [
            "http://erlyvideo.izone.az:80/realtv/mono.m3u8"
        ]
    },
    {
        "id": "DunyaTV",
        "name": "Dünya TV",
        "group": "Azerbaycan",
        "logo": "https://upload.wikimedia.org/wikipedia/az/thumb/2/29/D%C3%BCnya_TV_loqosu.png/300px-D%C3%BCnya_TV_loqosu.png",
        "sources": [
            "http://erlyvideo.izone.az:80/dunyatv/mono.m3u8"
        ]
    },
    {
        "id": "APATV",
        "name": "APA TV",
        "group": "Azerbaycan",
        "logo": "https://i.imgur.com/2CSW4V4.png",
        "sources": [
            "http://stream.apa.tv/apastream/index.m3u8"
        ]
    },
    {
        "id": "KanalS",
        "name": "Kanal S",
        "group": "Azerbaycan",
        "logo": "https://i.imgur.com/W0JBoSQ.png",
        "sources": [
            "https://lives.atv.az:5443/KANAL-S/streams/kanals.m3u8"
        ]
    },
    {
        "id": "KepezTV",
        "name": "Kəpəz TV",
        "group": "Azerbaycan",
        "logo": "https://upload.wikimedia.org/wikipedia/az/thumb/3/3e/K%C9%99p%C9%99z_TV_%282019-h.h.%29.png/300px-K%C9%99p%C9%99z_TV_%282019-h.h.%29.png",
        "sources": [
            "http://85.132.78.122:8050/hls/stream/index.m3u8"
        ]
    },
    {
        "id": "ELTV",
        "name": "EL TV",
        "group": "Azerbaycan",
        "logo": "https://i.imgur.com/tTlokZ2.png",
        "sources": [
            "https://live.eltv.az/live/eltv/playlist.m3u8"
        ]
    },
    {
        "id": "MuzTV",
        "name": "Muz TV Azerbaijan",
        "group": "Azerbaycan",
        "logo": "https://i.imgur.com/CjySP1V.png",
        "sources": [
            "http://erlyvideo.izone.az:80/muztv/mono.m3u8"
        ]
    },
    {
        "id": "KNMusic",
        "name": "KN Music TV",
        "group": "Azerbaycan",
        "logo": "https://www.knmusictv.com/wp-content/uploads/2026/01/LOGO2112.png",
        "sources": [
            "https://cdn4.yayin.com.tr/kntv/tracks-v1a1/mono.m3u8"
        ]
    },
    {
        "id": "GunAzTV",
        "name": "GunAz TV",
        "group": "Azerbaycan",
        "logo": "https://i.imgur.com/2ZnQazl.png",
        "sources": [
            "https://tv.gunaz.tv/hls/live.m3u8"
        ]
    },
    {
        "id": "4UTV720p",
        "name": "4U TV (720p)",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/PexhKwp.png",
        "sources": [
            "https://hls.4utv.live/hls/stream.m3u8"
        ]
    },
    {
        "id": "24TV720p",
        "name": "24 TV (720p)",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/8FO41es.png",
        "sources": [
            "https://turkmedya-live.ercdn.net/tv24/tv24.m3u8"
        ]
    },
    {
        "id": "360720pNot247",
        "name": "360 (720p) [Not 24/7]",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/agn47sQ.png",
        "sources": [
            "https://turkmedya-live.ercdn.net/tv360/tv360.m3u8"
        ]
    },
    {
        "id": "A2TV1080p",
        "name": "A2TV (1080p)",
        "group": "Turkiye",
        "logo": "https://iatv.tmgrup.com.tr/site/v2/a2tv/i/a2tv-logo.png",
        "sources": [
            "https://rnttwmjcin.turknet.ercdn.net/lcpmvefbyo/a2tv/a2tv.m3u8"
        ]
    },
    {
        "id": "AHaber1080p",
        "name": "A Haber (1080p)",
        "group": "Turkiye",
        "logo": "https://upload.wikimedia.org/wikipedia/commons/7/7c/Ahaber_Logo.png",
        "sources": [
            "https://rnttwmjcin.turknet.ercdn.net/lcpmvefbyo/ahaber/ahaber.m3u8"
        ]
    },
    {
        "id": "ASporSD1080p",
        "name": "A Spor SD (1080p)",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/ZhkZzLf.png",
        "sources": [
            "https://rnttwmjcin.turknet.ercdn.net/lcpmvefbyo/aspor/aspor.m3u8"
        ]
    },
    {
        "id": "AksuTV720p",
        "name": "Aksu TV (720p)",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/mgDCKiy.png",
        "sources": [
            "https://live.artidijitalmedya.com/artidijital_aksutv/aksutv/playlist.m3u8"
        ]
    },
    {
        "id": "AlZahraTVTurkic720pNot247",
        "name": "Al-Zahra TV Turkic (720p) [Not 24/7]",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/QEHKGnG.png",
        "sources": [
            "https://live.al-zahratv.com/live/playlist.m3u8"
        ]
    },
    {
        "id": "AlanyaPostaTV1080p",
        "name": "Alanya Posta TV (1080p)",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/a3w9eFe.png",
        "sources": [
            "https://api-tv3.yayin.com.tr/postatv/postatv/playlist.m3u8"
        ]
    },
    {
        "id": "AlmahriahTV576p",
        "name": "Almahriah TV (576p)",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/GgEeTNr.png",
        "sources": [
            "https://starmenajo.com/hls/almahriah/index.m3u8"
        ]
    },
    {
        "id": "AltasTV1080p",
        "name": "Altas TV (1080p)",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/XaJ7fp6.png",
        "sources": [
            "https://edge1.socialsmart.tv/altastv/bant1/playlist.m3u8"
        ]
    },
    {
        "id": "AnadoluNetTV1080p",
        "name": "Anadolu Net TV (1080p)",
        "group": "Turkiye",
        "logo": "https://www.anadolunettv.com/d/r/logo.png",
        "sources": [
            "https://live.artidijitalmedya.com/artidijital_anadolunet/anadolunet/playlist.m3u8"
        ]
    },
    {
        "id": "ArasTV576pNot247",
        "name": "Aras TV (576p) [Not 24/7]",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/JsDCyWG.png",
        "sources": [
            "http://1.rtmp.org/tv217/yayin.stream/playlist.m3u8"
        ]
    },
    {
        "id": "ASTV900p",
        "name": "AS TV (900p)",
        "group": "Turkiye",
        "logo": "https://asset.artidijitalmedya.com/image/188x188/channels/v1/logo_13.png",
        "sources": [
            "https://live.artidijitalmedya.com/artidijital_astv/astv/playlist.m3u8"
        ]
    },
    {
        "id": "ATVTurkiye1080p",
        "name": "ATV (Turkiye) (1080p)",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/HyVUwFC.png",
        "sources": [
            "https://rnttwmjcin.turknet.ercdn.net/lcpmvefbyo/atv/atv_1080p.m3u8"
        ]
    },
    {
        "id": "ATVAlanya1080p",
        "name": "ATV Alanya (1080p)",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/bUwarR0.png",
        "sources": [
            "https://cdn-alanyatv.yayin.com.tr/alanyatv/alanyatv/playlist.m3u8"
        ]
    },
    {
        "id": "BricveSatrancTV480pNot247",
        "name": "Bric ve Satranc TV (480p) [Not 24/7]",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/TXDV1ty.png",
        "sources": [
            "http://139.162.182.79/live/test/index.m3u8"
        ]
    },
    {
        "id": "BRTVTurkiye720pGeoblocked",
        "name": "BRTV (Turkiye) (720p) [Geo-blocked]",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/U3qlEAp.png",
        "sources": [
            "https://live.artidijitalmedya.com/artidijital_brtv/brtv/playlist.m3u8"
        ]
    },
    {
        "id": "CayTV720p",
        "name": "Cay TV (720p)",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/ndupxwu.png",
        "sources": [
            "https://edge1.socialsmart.tv/caytv/bant1/playlist.m3u8"
        ]
    },
    {
        "id": "CiftciTV720pNot247",
        "name": "Ciftci TV (720p) [Not 24/7]",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/CLzP4vL.png",
        "sources": [
            "https://live.artidijitalmedya.com/artidijital_ciftcitv/ciftcitv/playlist.m3u8"
        ]
    },
    {
        "id": "CNBCe",
        "name": "CNBC-e",
        "group": "Turkiye",
        "logo": "https://s.cnbce.com/dist/images/logo-nav.png",
        "sources": [
            "https://hnpsechtsc.turknet.ercdn.net/xpnvudnlsv/cnbc-e/cnbc-e.m3u8"
        ]
    },
    {
        "id": "DenizPostasiTV720pNot247",
        "name": "Deniz Postasi TV (720p) [Not 24/7]",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/Mm8hdfx.png",
        "sources": [
            "https://live.artidijitalmedya.com/artidijital_denizpostasi/denizpostasi/playlist.m3u8"
        ]
    },
    {
        "id": "DHA720pNot247",
        "name": "DHA (720p) [Not 24/7]",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/VZhag2x.png",
        "sources": [
            "https://603c568fccdf5.streamlock.net/live/dhaweb1_C5efC/playlist.m3u8"
        ]
    },
    {
        "id": "DiyanetTV1080p",
        "name": "Diyanet TV (1080p)",
        "group": "Turkiye",
        "logo": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/43/Diyanet_TV_logo.svg/960px-Diyanet_TV_logo.svg.png",
        "sources": [
            "https://eustr73.mediatriple.net/videoonlylive/mtikoimxnztxlive/broadcast_5e3bf95a47e07.smil/playlist.m3u8"
        ]
    },
    {
        "id": "DiyarTV720p",
        "name": "Diyar TV (720p)",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/qWkHjRA.png",
        "sources": [
            "https://live.artidijitalmedya.com/artidijital_diyartv/diyartv/playlist.m3u8"
        ]
    },
    {
        "id": "DostTV576p",
        "name": "Dost TV (576p)",
        "group": "Turkiye",
        "logo": "https://dosttv.com/wp-content/uploads/2022/02/dost_logo.png",
        "sources": [
            "https://dost.stream.emsal.im/tv/live.m3u8"
        ]
    },
    {
        "id": "DreamTurk720p",
        "name": "Dream Turk (720p)",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/vJ8VaZi.png",
        "sources": [
            "https://live.duhnet.tv/S2/HLS_LIVE/dreamturknp/playlist.m3u8"
        ]
    },
    {
        "id": "EdessaTV1080p",
        "name": "Edessa TV (1080p)",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/rhU6j9I.png",
        "sources": [
            "https://canli.edessatv.com/hls/stream.m3u8"
        ]
    },
    {
        "id": "Ekoturk720p",
        "name": "Ekoturk (720p)",
        "group": "Turkiye",
        "logo": "https://www.dsmart.com.tr/epg/images/0x60/5ffc18c6cfef0b15933a8b65",
        "sources": [
            "https://cdn.ekoturk.net/hls/master.m3u8"
        ]
    },
    {
        "id": "ElsharqTV1080pNot247",
        "name": "Elsharq TV (1080p) [Not 24/7]",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/8vmfZb5.png",
        "sources": [
            "https://mn-nl.mncdn.com/elsharq_live/live/playlist.m3u8"
        ]
    },
    {
        "id": "ERTV1080pGeoblocked",
        "name": "ERTV (1080p) [Geo-blocked]",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/VDGEPrD.png",
        "sources": [
            "https://live.artidijitalmedya.com/artidijital_ertv_new/ertv/playlist.m3u8"
        ]
    },
    {
        "id": "ErzurumWebTV720p",
        "name": "Erzurum Web TV (720p)",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/HF7N4Li.png",
        "sources": [
            "https://win29.yayin.com.tr/erzurumwebtv/erzurumwebtv/iptvdelisi.m3u8"
        ]
    },
    {
        "id": "ESTV720p",
        "name": "ES TV (720p)",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/epAEBrp.png",
        "sources": [
            "https://live.artidijitalmedya.com/artidijital_estv/estv/playlist.m3u8"
        ]
    },
    {
        "id": "ETVKayseri720p",
        "name": "ETV Kayseri (720p)",
        "group": "Turkiye",
        "logo": "https://yt3.googleusercontent.com/ytc/AIdro_msPtG6zfPKIJIIdvG4dehXLoVoXcHM2-2HL9YxsNYzGQ=s512-c-k-c0x00ffffff-no-rj",
        "sources": [
            "https://live.artidijitalmedya.com/artidijital_etv/etv/playlist.m3u8"
        ]
    },
    {
        "id": "ETVManisa1080pNot247",
        "name": "ETV Manisa (1080p) [Not 24/7]",
        "group": "Turkiye",
        "logo": "https://i.ibb.co/QKXtdkz/sOd3INg.png",
        "sources": [
            "https://edge1.socialsmart.tv/manisaetv/bant1/playlist.m3u8"
        ]
    },
    {
        "id": "EuroD720p",
        "name": "Euro D (720p)",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/x9kHsXo.png",
        "sources": [
            "https://live.duhnet.tv/S2/HLS_LIVE/eurodnp/playlist.m3u8"
        ]
    },
    {
        "id": "FBTV",
        "name": "FB TV",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/qBVqtYd.png",
        "sources": [
            "http://1hskrdto.rocketcdn.com/fenerbahcetv.smil/playlist.m3u8"
        ]
    },
    {
        "id": "FinansTurkTV720p",
        "name": "Finans Turk TV (720p)",
        "group": "Turkiye",
        "logo": "https://i.ibb.co/wBwmB1T/iY0osc7.png",
        "sources": [
            "https://yayin30.haber100.com/live/finansturk/playlist.m3u8"
        ]
    },
    {
        "id": "FlashHaberTV",
        "name": "Flash Haber TV",
        "group": "Turkiye",
        "logo": "",
        "sources": [
            "https://b01c02nl.mediatriple.net/videoonlylive/mtyycglqauzjhlive/broadcast_67c053c48829f.smil/playlist.m3u8"
        ]
    },
    {
        "id": "FortunaTV720p",
        "name": "Fortuna TV (720p)",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/ZbUSlOC.png",
        "sources": [
            "https://edge1.socialsmart.tv/ftvturk/bant1/playlist.m3u8"
        ]
    },
    {
        "id": "GuneydoguTV720p",
        "name": "Guneydogu TV (720p)",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/JT5pp3Y.png",
        "sources": [
            "https://edge1.socialsmart.tv/gtv/bant1/playlist.m3u8"
        ]
    },
    {
        "id": "Haber61TV720pNot247",
        "name": "Haber61 TV (720p) [Not 24/7]",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/2a2XUKl.png",
        "sources": [
            "https://cdn-haber61tv.yayin.com.tr/haber61tv/smil:haber61tv.smil/index.m3u8"
        ]
    },
    {
        "id": "HaberGlobal720pNot247",
        "name": "Haber Global (720p) [Not 24/7]",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/fu6XeGS.png",
        "sources": [
            "https://tv.ensonhaber.com/haberglobal/haberglobal.m3u8"
        ]
    },
    {
        "id": "HaberturkTV720pNot247",
        "name": "Haberturk TV (720p) [Not 24/7]",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/6Tw3rUp.png",
        "sources": [
            "https://tv.ensonhaber.com/haberturk/haberturk.m3u8"
        ]
    },
    {
        "id": "HalkTVSD1080p",
        "name": "Halk TV SD (1080p)",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/xM0HA30.png",
        "sources": [
            "https://halktv-live.daioncdn.net/halktv/halktv.m3u8"
        ]
    },
    {
        "id": "HTSporTV1080p",
        "name": "HTSpor TV (1080p)",
        "group": "Turkiye",
        "logo": "https://www.htspor.com/images/manifest/social-share-logo.png",
        "sources": [
            "https://ciner.daioncdn.net/ht-spor/ht-spor.m3u8?app=web"
        ]
    },
    {
        "id": "IcelTV720pNot247",
        "name": "Icel TV (720p) [Not 24/7]",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/CGwImKv.png",
        "sources": [
            "https://edge1.socialsmart.tv/iceltv/bant1/playlist.m3u8"
        ]
    },
    {
        "id": "IlkeTV1080p",
        "name": "Ilke TV (1080p)",
        "group": "Turkiye",
        "logo": "https://ilketv.com.tr/wp-content/uploads/2024/06/logo.png",
        "sources": [
            "https://stream.ilketv.com.tr/hls/ilkecanli.m3u8"
        ]
    },
    {
        "id": "Kanal31080pNot247",
        "name": "Kanal 3 (1080p) [Not 24/7]",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/eXErSv0.png",
        "sources": [
            "https://live.artidijitalmedya.com/artidijital_kanal3/kanal3/playlist.m3u8"
        ]
    },
    {
        "id": "Kanal7Avrupa720pNot247",
        "name": "Kanal 7 Avrupa (720p) [Not 24/7]",
        "group": "Turkiye",
        "logo": "https://i.imgur.com/wlfyj5l.png",
        "sources": [
            "https://livetv.radyotvonline.net/kanal7live/kanal7avr/playlist.m3u8"
        ]
    },
    {
        "id": "1HDMusicTelevision1080p",
        "name": "1HD Music Television (1080p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/4Ww7CsR.png",
        "sources": [
            "http://176.118.197.101/1HD/index.m3u8"
        ]
    },
    {
        "id": "2x2576i",
        "name": "2x2 (576i)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/fhQFLEl.png",
        "sources": [
            "https://bl.rutube.ru/livestream/392b4686b770bae2da6bf5ac4574add5/index.m3u8?e=2068731801&s=tenr-yHXUv1wibfka78s2A&scheme=https"
        ]
    },
    {
        "id": "3ABNRussia720p",
        "name": "3ABN Russia (720p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/4fhBbam.png",
        "sources": [
            "https://hls.tv.3angels.ru/stream.m3u8"
        ]
    },
    {
        "id": "5minuttishiny1080p",
        "name": "5 minut tishiny (1080p)",
        "group": "Rusiya",
        "logo": "https://cdn2-static.ntv.ru/home/promo/24740/5minut_live.jpg",
        "sources": [
            "https://cdn-dvr.ntv.ru/5_minut_tishiny/index.m3u8"
        ]
    },
    {
        "id": "861080pNot247",
        "name": "86 (1080p) [Not 24/7]",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/0dRS4Cb.png",
        "sources": [
            "https://sitv.ru/hls/s86.m3u8"
        ]
    },
    {
        "id": "3601080p",
        "name": "360° (1080p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/VTJqdoX.png",
        "sources": [
            "https://cdn-evacoder-tv.facecast.io/evacoder_hls_hi/CkxfR1xNUAJwTgtXTBZTAJli/index.m3u8"
        ]
    },
    {
        "id": "360News1080p",
        "name": "360° News (1080p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/YXDeX8q.png",
        "sources": [
            "https://live-vgtrksmotrim.cdnvideo.ru/vgtrksmotrim/smotrim-live-03-srt.smil/playlist.m3u8"
        ]
    },
    {
        "id": "365daysTV576p",
        "name": "365 days TV (576p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/NfnAiTR.png",
        "sources": [
            "http://stream.mcquack.net/70/index.m3u8"
        ]
    },
    {
        "id": "black576p",
        "name": ".black (576p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/Q4A6ci4.png",
        "sources": [
            "http://stream.mcquack.net/263/index.m3u8"
        ]
    },
    {
        "id": "red576p",
        "name": ".red (576p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/GET9Qut.png",
        "sources": [
            "http://5.188.159.128:8070/RED/index.m3u8"
        ]
    },
    {
        "id": "redHD1080p",
        "name": ".red HD (1080p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/GET9Qut.png",
        "sources": [
            "http://178.134.1.158:8081/red/index.m3u8"
        ]
    },
    {
        "id": "scifi576p",
        "name": ".sci-fi (576p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/nSSUHcg.png",
        "sources": [
            "http://stream.mcquack.net/180/index.m3u8"
        ]
    },
    {
        "id": "Afontovo",
        "name": "Afontovo",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/StFfPaI.png",
        "sources": [
            "https://stream.afontovo.ru/hd.m3u8"
        ]
    },
    {
        "id": "AISTTV1080p",
        "name": "AIST TV (1080p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/bcw0s4V.png",
        "sources": [
            "http://live2-aisttv.cdnvideo.ru/aisttv2/aisttv.sdp/playlist.m3u8"
        ]
    },
    {
        "id": "AmediaHit1080p",
        "name": "Amedia Hit (1080p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/a8ZBGBw.png",
        "sources": [
            "http://stream.mcquack.net/162/index.m3u8"
        ]
    },
    {
        "id": "AngelTVRussian720p",
        "name": "Angel TV Russian (720p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/qKLEGU7.png",
        "sources": [
            "https://janya-digimix.akamaized.net/vglive-sk-955415/russia/ngrp:angelrussia_all/playlist.m3u8"
        ]
    },
    {
        "id": "AnimalPlanetRussia1080p",
        "name": "Animal Planet (Russia) (1080p)",
        "group": "Rusiya",
        "logo": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/20/2018_Animal_Planet_logo.svg/960px-2018_Animal_Planet_logo.svg.png",
        "sources": [
            "http://stream.mcquack.net/114/index.m3u8"
        ]
    },
    {
        "id": "Aris24720pNot247",
        "name": "Aris 24 (720p) [Not 24/7]",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/CTFVEAb.png",
        "sources": [
            "http://serv25.vintera.tv:8081/test/aris/playlist.m3u8"
        ]
    },
    {
        "id": "Arkhyz241080p",
        "name": "Arkhyz 24 (1080p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/blAtdkJ.png",
        "sources": [
            "https://live.mediacdn.ru/sr1/arhis24/playlist.m3u8"
        ]
    },
    {
        "id": "Arsenal576p",
        "name": "Arsenal (576p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/DBpVeb0.png",
        "sources": [
            "https://stream8.cinerama.uz/1414/tracks-v1a1/mono.m3u8"
        ]
    },
    {
        "id": "ARTRussia576p",
        "name": "ART (Russia) (576p)",
        "group": "Rusiya",
        "logo": "https://optim.tildacdn.com/tild3134-3836-4338-a138-666666653363/-/format/webp/__.png.webp",
        "sources": [
            "http://89.104.114.24:8080/art/index.m3u8"
        ]
    },
    {
        "id": "Astrahan24720p",
        "name": "Astrahan 24 (720p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/9WcnjQN.png",
        "sources": [
            "https://streaming.astrakhan.ru/astrakhan24/playlist.m3u8"
        ]
    },
    {
        "id": "AstrahanRuSport720p",
        "name": "Astrahan.Ru Sport (720p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/BKaEtqL.png",
        "sources": [
            "https://streaming.astrakhan.ru/astrakhanrusporthd/playlist.m3u8"
        ]
    },
    {
        "id": "AstrahanRuTV480p",
        "name": "Astrahan.Ru TV (480p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/w4ys6zm.png",
        "sources": [
            "https://streaming.astrakhan.ru/astrakhanrulivehd/playlist.m3u8"
        ]
    },
    {
        "id": "Avto24576p",
        "name": "Avto24 (576p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/GXSXmN2.png",
        "sources": [
            "http://stream.mcquack.net/78/index.m3u8"
        ]
    },
    {
        "id": "BabyTime576p",
        "name": "Baby Time (576p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/lW3WIBD.png",
        "sources": [
            "http://178.134.1.158:8081/babytime/index.m3u8"
        ]
    },
    {
        "id": "Balabol1080p",
        "name": "Balabol (1080p)",
        "group": "Rusiya",
        "logo": "https://cdn2-static.ntv.ru/home/promo/24740/balabol_vse.jpg",
        "sources": [
            "https://cdn-dvr.ntv.ru/Balabol/index.m3u8"
        ]
    },
    {
        "id": "Belgorod241080p",
        "name": "Belgorod 24 (1080p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/EEirvyx.png",
        "sources": [
            "https://belnovosti.cdn.easyhoster.ru:8443/stream.m3u8"
        ]
    },
    {
        "id": "BigAsia720p",
        "name": "Big Asia (720p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/vruuPKF.png",
        "sources": [
            "http://live-bigasia.cdnvideo.ru/bigasia/bigasia.smil/playlist.m3u8"
        ]
    },
    {
        "id": "BlokbasterHD1080p",
        "name": "Blokbaster HD (1080p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/KcOi4Os.png",
        "sources": [
            "http://stream.mcquack.net/364/index.m3u8"
        ]
    },
    {
        "id": "BollywoodHD576p",
        "name": "Bollywood HD (576p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/YLQRnXt.png",
        "sources": [
            "http://176.118.197.101/Bollywood_HD/index.m3u8"
        ]
    },
    {
        "id": "BollywoodHDRussia576p",
        "name": "Bollywood HD Russia (576p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/scDKOLS.png",
        "sources": [
            "https://xykt-fix.github.io/cinerama_edge01/hls/BOLLYWOOD_RU/Movie009.m3u8"
        ]
    },
    {
        "id": "BRIDGE576p",
        "name": "BRIDGE (576p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/qYObfrG.png",
        "sources": [
            "http://stream.mcquack.net/318/index.m3u8"
        ]
    },
    {
        "id": "BRIDGEClassic576p",
        "name": "BRIDGE Classic (576p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/JJTQq81.png",
        "sources": [
            "http://stream.mcquack.net/272/index.m3u8"
        ]
    },
    {
        "id": "BRIDGEDeluxeHD576p",
        "name": "BRIDGE Deluxe HD (576p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/EazL8w7.png",
        "sources": [
            "http://stream.mcquack.net/92/index.m3u8"
        ]
    },
    {
        "id": "BRIDGEHits576p",
        "name": "BRIDGE Hits (576p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/sIW9oR4.png",
        "sources": [
            "http://stream.mcquack.net/320/index.m3u8"
        ]
    },
    {
        "id": "BRIDGERock576p",
        "name": "BRIDGE Rock (576p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/MHuwct2.png",
        "sources": [
            "http://178.134.1.158:8081/BRIDGEROCK/index.m3u8"
        ]
    },
    {
        "id": "BST576p",
        "name": "BST (576p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/IDotHmQ.png",
        "sources": [
            "https://bsttv.bonus-tv.ru/cdn/bst/playlist.m3u8"
        ]
    },
    {
        "id": "Carousel4720p",
        "name": "Carousel +4 (720p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/4wmnx1W.png",
        "sources": [
            "http://185.37.150.46/Karusel/index.m3u8"
        ]
    },
    {
        "id": "Channel5Russia576p",
        "name": "Channel 5 (Russia) (576p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/KPXMa3U.png",
        "sources": [
            "http://31.148.5.241/kanal_5/index.m3u8"
        ]
    },
    {
        "id": "Channel8Russia576p",
        "name": "Channel 8 (Russia) (576p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/nUSx1jF.png",
        "sources": [
            "http://45.11.139.43:8555/8kanal/index.m3u8"
        ]
    },
    {
        "id": "likeGeckoChrome150000Safari53736Edg150000",
        "name": "like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0",
        "group": "Rusiya",
        "logo": "",
        "sources": [
            "https://tshift-1.telecoma.tv/8channel/tracks-v1a1/mono.ts.m3u8"
        ]
    },
    {
        "id": "likeGeckoChrome150000Safari53736Edg150000",
        "name": "like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0",
        "group": "Rusiya",
        "logo": "",
        "sources": [
            "https://live-8knsk.cdnvideo.ru/8knsk/stream1/playlist.m3u8"
        ]
    },
    {
        "id": "Channel10Russia576i",
        "name": "Channel 10 (Russia) (576i)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/k8JjFDw.png",
        "sources": [
            "https://bl.rutube.ru/livestream/c9e26bf5c003fd8d477200065ca1a05f/index.m3u8?e=2072611029&s=eqlTXebDP9wSWTZgre6BwQ&scheme=https"
        ]
    },
    {
        "id": "Channel121080p",
        "name": "Channel 12 (1080p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/OA9hm6e.png",
        "sources": [
            "https://12channel.bonus-tv.ru/cdn/12channel/playlist.m3u8"
        ]
    },
    {
        "id": "Channel16406pNot247",
        "name": "Channel-16 (406p) [Not 24/7]",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/7tNDKHe.png",
        "sources": [
            "http://serv25.vintera.tv:8081/test/k16/playlist.m3u8"
        ]
    },
    {
        "id": "Che576p",
        "name": "Che! (576p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/ZOcDGpB.png",
        "sources": [
            "http://flussonic.linkintel.ru/che/index.m3u8"
        ]
    },
    {
        "id": "CinemaRussia576p",
        "name": "Cinema (Russia) (576p)",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/b5e9qUA.png",
        "sources": [
            "http://flussonic.linkintel.ru/cinema/index.m3u8"
        ]
    },
    {
        "id": "CityEdenAutoGidNot247",
        "name": "City Eden AutoGid [Not 24/7]",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/qpe8L27.png",
        "sources": [
            "https://cityeden.catcast.tv/content/47515/index.m3u8"
        ]
    },
    {
        "id": "CityEdenBirmaPlayNot247",
        "name": "City Eden Birma Play [Not 24/7]",
        "group": "Rusiya",
        "logo": "https://i.imgur.com/38Q5L5W.png",
        "sources": [
            "https://cityeden.catcast.tv/content/34364/index.m3u8"
        ]
    }
]
