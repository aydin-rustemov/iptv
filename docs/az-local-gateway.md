# Azərbaycan IPTV — yerli Yoda gateway

## Problemin səbəbi
Yoda.az M3U8 ünvanlarında 30 dəqiqəlik, IP və User-Agent məlumatına bağlı tokenlərdən istifadə edir. GitHub-un başqa ölkədəki IP ünvanı ilə alınan link Azərbaycan IPTV tətbiqində açılmaya bilər. Tokensiz index.m3u8 linkləri də işləməyə bilər.

## İş prinsipi
Azərbaycan internetinə qoşulmuş cihazda Node.js + Playwright Chromium işləyir. IPTV tətbiqi sabit yerli linkə qoşulur. Servis Yoda-nın kanal səhifəsini eyni xarici IP-dən açır, kanalın adına uyğun təzə M3U8 ünvanını götürür, HLS manifest və seqmentləri həmin IP-dən ötürür. Yalnız yodacdn.net ailəsinə icazə var. Yayım sahibi tərəfindən verilmiş istifadə icazələri yenə qüvvədədir.

Bu komponent kod və avtomatik test səviyyəsində hazırlanıb, Azərbaycan IP-si üzərindən real end-to-end playback testi hələ edilməyib. ARB səhifəsindən NTV video ünvanı çıxarsa, səhv kanalın göstərilməsi əvəzinə xəta qaytaracaq. Sayt login, DRM və ya əlavə sessiya yoxlaması tələb edirsə, işləməyə bilər.

## Quraşdırma
Node.js 22 tələb olunur. 1 GB RAM-lı Orange Pi-də Chromium yaddaş çatışmazlığı yarada bilər. Əvvəl Azərbaycan internetinə qoşulmuş kompüterdə test məsləhətdir.

Linux / Orange Pi:
    git clone https://github.com/aydin-rustemov/iptv.git
    cd iptv
    npm ci
    npx playwright install --with-deps chromium
    AZ_GATEWAY_HOST=0.0.0.0 AZ_GATEWAY_PORT=8787 npm run gateway:az

Windows PowerShell:
    npm ci
    npx playwright install chromium
    $env:AZ_GATEWAY_HOST="0.0.0.0"
    $env:AZ_GATEWAY_PORT="8787"
    npm run gateway:az

## IPTV proqramına əlavə edilən link
Serverin yerli IP ünvanı məsələn 192.168.1.88 olduqda aşağıdakı URL-lərdən istifadə edin (həqiqi LAN IP ilə əvəz edin):

- IPTV playlist: http://192.168.1.88:8787/playlist.m3u
- ARB yoxlama: http://192.168.1.88:8787/live/arb/index.m3u8
- Diaqnostika: http://192.168.1.88:8787/health

Yerli server dayansa, yayım da dayanacaq. Server və player eyni ev internetində olmalıdır. Routerdə 8787 portu üçün internetdən port yönləndirmə (port forwarding) ETMƏYİN. Yerli firewall bu LAN portuna icazə verməlidir.

## Əvvəlki playlist haqqında
output/azerbaijan-manual.m3u faylının tokensiz ünvanları istifadəçinin cihazında işləməyib, onlardan işlək playlist kimi istifadə etməyin. GitHub-dakı avtomatik playlist yeniləməsi təmir müddətində bağlı saxlanılıb.

## Xətaların diaqnostikası
- /health açılmır: gateway işləmir və ya LAN/firewall problemi var.
- /live/arb/index.m3u8 502 göstərir: lokal brauzer Yoda-dan düzgün ARB tokenini ala bilmədi və ya upstream onu qəbul etmədi.
- Browser Playwright quraşdırılmır: npx playwright install --with-deps chromium.
- ARB səhifəsi yalnız ntv/video.m3u8 sorğusu göndərirsə bu ARB yayımı deyil və şüurlu şəkildə rədd edilir.
- HTTP 403: regional icazə, səhifə sessiyası və ya headers problemi mümkündür; Yoda rəsmi səhifəsi ilə yerli müqayisə aparın.

Unit test: npm run typecheck && npm test. Bu, yerli IP ilə real video oynadılmasının təsdiqi deyil.
