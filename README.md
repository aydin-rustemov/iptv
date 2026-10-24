# Automated IPTV Stream Orchestrator & Live Playlist

[![Update IPTV Channels](https://github.com/aydin-rustemov/iptv/actions/workflows/update-iptv.yml/badge.svg)](https://github.com/aydin-rustemov/iptv/actions/workflows/update-iptv.yml)
[![Channels Count](https://img.shields.io/badge/Channels-145%2B%20Active-brightgreen.svg)](#pleylist)
[![Update Frequency](https://img.shields.io/badge/Update-Every%203%20Hours-blue.svg)](#avtomatlasdirma)

Qabaqcıl arxitekturaya malik, **hər 3 saatdan bir GitHub Actions ilə avtomatik işə düşən**, Azərbaycan, Türkiyə (o cümlədən 30 əsas milli kanal) və Rusiya kanallarının canlı `.m3u8` axınlarını paralel yoxlayan, işləməyən linkləri dərhal ehtiyat mənbələrlə bərpa edən və IPTV pleyerlər üçün vahid `playlist.m3u` faylını formalaşdıran avtomatlaşdırılmış sistem.

---

## 📺 Hazır Pleylist Linki (IPTV Pleyerlər Üçün)

Aşağıdakı linki birbaşa **VLC**, **TiviMate**, **IPTV Smarters**, **OTT Navigator** və ya **Smart TV / Android TV** pleyerinizə daxil edə bilərsiniz. Sistem hər 3 saatdan bir linkləri arxa fonda yenilədiyi üçün sizin təkrar heç nə yükləməyinizə ehtiyac yoxdur.

| Pleylist | Təsvir | Birbaşa Raw Link |
|---|---|---|
| **Vahid Pleylist (playlist.m3u)** | 145+ Aktiv Kanal (Azərbaycan + Türkiyə 30 Əsas + Rusiya) | `https://raw.githubusercontent.com/aydin-rustemov/iptv/main/output/playlist.m3u` |

---

## 🇹🇷 Əlavə Edilmiş 30 Əsas Türkiyə Kanalı

Sistemdə xüsusi olaraq prioritetləşdirilmiş və aktiv HLS axınları təmin edilmiş 30 milli Türkiyə kanalı:
1. **TRT 1** (Rəsmi TRT CDN)
2. **ATV** (Turkuvaz CDN)
3. **Kanal D** (Demirören Daion CDN)
4. **Star TV** (Doğuş Daion CDN)
5. **Show TV** (Volo Live HLS)
6. **Fox TV (NOW TV)** (NOW CDN)
7. **TV8** (Acun Medya Daion CDN)
8. **NTV** (Doğuş Daion CDN)
9. **CNN Türk** (Demirören Duhnet HLS)
10. **TRT Spor** (Daion CDN)
11. **A Haber** (Turkuvaz CDN)
12. **Habertürk** (Live HLS)
13. **TRT Haber** (Rəsmi TRT CDN)
14. **TRT Çocuk** (Rəsmi TRT CDN)
15. **Cartoon Network Türkiye** (Turner / McQuack HLS)
16. **Minika GO** (Turkuvaz CDN)
17. **Minika Çocuk** (Turkuvaz CDN)
18. **TRT World** (Rəsmi TRT CDN)
19. **beIN SPORTS Haber** (Sports HLS)
20. **Kanal 7** (Daion CDN)
21. **TRT 2** (Rəsmi TRT CDN)
22. **Beyaz TV** (HDTV CDN)
23. **Bloomberg HT** (Live HLS)
24. **Discovery Channel Türkiye** (1080p FHD HLS)
25. **National Geographic Türkiye** (1080p FHD HLS)
26. **TLC Türkiye** (Doğuş Daion CDN)
27. **DMAX Türkiye** (Doğuş Daion CDN)
28. **Eurosport Türkiye** (Sports HLS)
29. **TV8.5** (Acun Medya Daion CDN)
30. **Kanal 24** (Türkmedya CDN)

---

## 🛠 Texniki Arxitektura (Senior Architect Design)

```
iptv/
├── .github/workflows/
│   └── update-iptv.yml       # Hər 3 saatdan bir işləyən cron və manual trigger
├── src/
│   ├── config.py             # 140+ kanal kataloqu, rəsmi loqolar, qrup təyinatları və mənbələr
│   ├── validator.py          # Çox yivli (ThreadPool) HLS manifest yoxlayıcı
│   ├── scraper.py            # Saytlardan canlı m3u8 axınlarını çıxaran fallback scraper
│   └── m3u_builder.py        # Standart M3U generator (#EXTVLCOPT & #EXTHTTP dəstəyi ilə)
├── output/
│   └── playlist.m3u          # Bütün aktiv kanalları cəmləyən vahid pleylist
├── playlist.m3u              # Kök qovluqda alternativ eyniləşdirilmiş pleylist
├── report.json               # Son skan və diaqnostika hesabatı
└── run.py                    # Əsas orkestrator skript
```

---

## ⚡ Avtomatlaşdırma (GitHub Actions)

Workflow faylı `.github/workflows/update-iptv.yml`:
- **Cron cədvəli:** `0 */3 * * *` (Hər 3 saatdan bir tam avtomatik).
- **Manual Trigger:** `workflow_dispatch` vasitəsilə GitHub UI-dən istənilən an bir kliklə işə salına bilər.
- Yalnız dəyişiklik olduqda və ya linklər təzələndikdə `git commit` edib avtomatik push edir.
