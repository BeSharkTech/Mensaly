import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { FilesController } from "./files.controller";
import { filesConfiguration } from "./files.configuration";
import { FilesService } from "./files.service";
import { LocalStorageAdapter } from "./local-storage.adapter";
import {
  FILE_SIZE_LIMIT,
  STORAGE_ADAPTER,
} from "./storage.adapter";

@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [FilesController],
  providers: [
    FilesService,
    {
      provide: STORAGE_ADAPTER,
      useFactory: () => {
        return new LocalStorageAdapter(filesConfiguration().root);
      },
    },
    {
      provide: FILE_SIZE_LIMIT,
      useFactory: () => filesConfiguration().sizeLimit,
    },
  ],
})
export class FilesModule {}
