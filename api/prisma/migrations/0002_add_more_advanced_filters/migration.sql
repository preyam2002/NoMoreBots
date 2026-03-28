ALTER TABLE "ExtensionUser"
ADD COLUMN "filterRacism" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "filterVaguePosting" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "filterFearmongering" BOOLEAN NOT NULL DEFAULT false;
