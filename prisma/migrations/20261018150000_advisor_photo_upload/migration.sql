-- Rådgiverfoto: upload til eget lager i stedet for en ekstern URL.
--
-- Eksterne foto-URL'er lækkede besøgendes IP-adresser til tredjeparter og krævede `img-src https:` i CSP'en. Nu gemmes
-- billedet (behandlet med sharp: EXIF/GPS fjernet, 512×512 + 96×96 WebP) i objektlageret, og appen serverer det selv.
--
-- Før lancering: eksisterende værdier i "photoUrl" droppes bevidst og migreres ikke (seed-data har ingen fotos, og en
-- ekstern URL kan ikke genbruges uden at hente billedet fra tredjepart). Rådgivere uden billede vises med initialer, og
-- billedet kan uploades igen under Min profil eller af admin.
ALTER TABLE "AdvisorProfile" DROP COLUMN "photoUrl",
ADD COLUMN "photoKey" TEXT,
ADD COLUMN "photoUpdatedAt" TIMESTAMP(3);
