# IPTV Project Documentation Pack

Bu paket sıfırdan qurulacaq **rəsmi mənbəli IPTV playlist avtomatlaşdırma sistemi** üçün məhsul, arxitektura, təhlükəsizlik, test və implementasiya sənədləridir.

## Necə istifadə etməli

1. Kompüterdə boş `iptv` qovluğu yaradın.
2. Bu ZIP faylındakı bütün faylları həmin qovluğa çıxarın.
3. Qovluğu Roo Code-da yeni agent ilə açın.
4. Agentə əvvəlcə aşağıdakı faylı tam oxumağı deyin:

   `00_MASTER_IMPLEMENTATION_PROMPT.md`

5. Ən təhlükəsiz üsul həmin faylın tam mətnini Roo Code agentinə prompt kimi verməkdir.
6. Agent sənədləri oxuyaraq layihəni sıfırdan qurmalı, test etməli və uğursuzluqları eyni sessiyada düzəltməlidir.
7. Agent Git-i inicializasiya etməməli və heç bir remote-a push etməməlidir. GitHub repository-ni layihə lokal yoxlamalardan keçdikdən sonra istifadəçi yaradacaq.

## Sənədlərin üstünlük sırası

Tələblər ziddiyyət təşkil etdikdə aşağıdakı üstünlük sırası tətbiq olunur:

1. `docs/00_DECISIONS.md`
2. `docs/01_PRODUCT_REQUIREMENTS.md`
3. `docs/03_OFFICIAL_SOURCE_POLICY.md`
4. `docs/08_SECURITY.md`
5. `docs/02_ARCHITECTURE.md`
6. Digər spesifikasiya sənədləri
7. `00_MASTER_IMPLEMENTATION_PROMPT.md`

Bu sıra ona görə vacibdir ki, agent rahatlıq naminə rəsmi mənbə, təhlükəsizlik və hüquqi məhdudiyyətləri zəiflətməsin.

## Əsas reallıq

- 250–300 rəqəmi **namizəd kanal reyestri üçün hədəfdir**.
- Yayımlanan M3U yalnız həmin yoxlamada işləyən və siyasətə uyğun kanalları ehtiva edir.
- Rəsmi açıq stream sayı hədəfdən azdırsa, agent saxta, pirat, müvəqqəti və ya sübutsuz link əlavə etməməlidir.
- Sistem GitHub Actions üzərindən hər 3 saatdan bir işləmək üçün hazırlanır.
- GitHub-hosted runner region məhdudiyyətlərinə görə bəzi kanalları düzgün yoxlaya bilməyə bilər.
