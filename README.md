# Automated IPTV Stream Orchestrator & Live Playlist

[![Update IPTV Channels](https://github.com/aydin-rustemov/iptv/actions/workflows/update-iptv.yml/badge.svg)](https://github.com/aydin-rustemov/iptv/actions/workflows/update-iptv.yml)
[![Channels Count](https://img.shields.io/badge/Channels-120%2B%20Active-brightgreen.svg)](#pleylist)
[![Update Frequency](https://img.shields.io/badge/Update-Every%203%20Hours-blue.svg)](#avtomatlaşdırma)

Qabaqcıl arxitekturaya malik, **hər 3 saatdan bir GitHub Actions ilə avtomatik işə düşən**, Azərbaycan, Türkiyə və Rusiya kanallarının canlı `.m3u8` yayımlarını yoxlayan, işləməyən linkləri dərhal bərpa edən və IPTV pleyerlər üçün vahid `player.m3u` pleylistini formalaşdıran avtomatlaşdırılmış sistem.

---

## 📺 Hazır Pleylist Linki (IPTV Pleyerlər üçün)

Aşağıdakı linki birbaşa **VLC**, **TiviMate**, **IPTV Smarters**, **OTT Navigator** və ya **Smart TV** pleyerinizə daxil edə bilərsiniz. Sistem hər 3 saatdan bir linkləri arxa fonda yenilədiyi üçün sizin təkrar heç nə yükləməyinizə ehtiyac yoxdur.

| Pleylist | Təsvir | Birbaşa Raw Link |
|---|---|---|
| **Vahid Pleyer Pleylisti (player.m3u)** | 120+ Aktiv Kanal (Azərbaycan + Türkiyə + Rusiya) | `https://raw.githubusercontent.com/aydin-rustemov/iptv/main/player.m3u` |

---

## 🚀 Texniki Arxitektura (Senior Architect Design)

Sistem 5 əsas moduldan ibarətdir:

```
iptv/
├── .github/workflows/
│   └── update-iptv.yml       # Hər 3 saatdan bir çalışan cron və manual trigger
├── src/
│   ├── config.py             # 120+ kanal kataloqu, rəsmi loqolar, qrup təyinatları və mənbələr
│   ├── validator.py          # Çoxaxınlı (multi-threaded) HLS və SSL yoxlayıcısı
│   ├── scraper.py            # Ehtiyat canlı yayım tutucusu (Web & Mirror Harvester)
│   └── m3u_builder.py        # Standartlara uyğun M3U generatoru (Referer və VLC direktivləri ilə)
├── run.py                    # Əsas orkestrator (bütün prosesi cəmi ~3-5 saniyədə icra edir)
├── requirements.txt          # Asılılıqlar
├── player.m3u                # Vahid pleyer pleylist faylı (120+ aktiv kanal)
└── report.json               # Hər icraatın dəqiq diaqnostika hesabatı (latency, status)
```

### 1. Çoxaxınlı Yoxlama (Concurrency & Ultra-Fast Probing)
* `ThreadPoolExecutor` vasitəsilə 15 axında eyni anda 120 kanal yoxlanılır.
* Bütün 120 kanalın yoxlanması və pleylistlərin generasiyası cəmi **3–5 saniyə** çəkir.
* `stream=True` ilə video faylı yüklənmədən yalnız HLS manifestinin ilk 1KB-ı (`#EXTM3U` başlığı) oxunur (minimum trafik sərfiyyatı).

### 2. Hotlink və Referer Qorumasının Aşılması
* Bəzi telekanallar (məsələn, AzTV) yayımlarını `Referer` başlığı olmadan bloklayır.
* M3U generatoru avtomatik olaraq `#EXTVLCOPT:http-referrer=...` və `#EXTHTTP:{"Referer":"..."}` direktivlərini fayla yazır, beləliklə VLC və IPTV tətbiqləri rəsmi sayt kimi müraciət edərək bloklanmır.

### 3. Təcrid Olunmuş Xəta İdarəetməsi (Fault-Tolerant)
* Bir kanalın serveri xəta versə belə, digər 119 kanal bundan təsirlənmir. Skript heç vaxt çökmür və dayanmır.

---

## 🛠️ Lokal İstifadə və Test

```bash
# Asılılıqları quraşdırın
pip install -r requirements.txt

# Orkestratoru işə salın
python run.py
```
