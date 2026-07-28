import { fileURLToPath } from "node:url";

import { createMensalyConfig } from "@mensaly/eslint-config";

const rootDirectory = fileURLToPath(new URL(".", import.meta.url));

export default createMensalyConfig({ rootDirectory });
