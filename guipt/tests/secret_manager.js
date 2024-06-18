// const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

const client = new SecretManagerServiceClient();
async function accessSecret() {
  const [version] = await client.accessSecretVersion({
    name: 'projects/guiruggiero/secrets/test/versions/latest',
  });
  const payload = version.payload.data.toString('utf8');
  console.log(`Secret data: ${payload}`);
}

accessSecret();