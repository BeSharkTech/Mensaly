import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { FilesController } from "./files.controller";
import { filesConfiguration } from "./files.configuration";
import { FilesService } from "./files.service";
import { LocalStorageAdapter } from "./local-storage.adapter";
import { S3StorageAdapter } from "./s3-storage.adapter";
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
        const configuration = filesConfiguration();
        return configuration.driver === "s3"
          ? new S3StorageAdapter(configuration.s3!)
          : new LocalStorageAdapter(configuration.root);
      },
    },
    {
      provide: FILE_SIZE_LIMIT,
      useFactory: () => filesConfiguration().sizeLimit,
    },
  ],
  exports: [FilesService, STORAGE_ADAPTER],
})
export class FilesModule {}
