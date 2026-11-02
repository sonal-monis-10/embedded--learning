import { randomUUID } from 'node:crypto';

// Talks to Mosquitto's Dynamic Security plugin, which holds the broker's
// logins and permissions. Each command is published to $CONTROL and its
// answer read back by correlation ID; a failed command throws, so MongoDB
// and Mosquitto never disagree silently.

const TOPIC = '$CONTROL/dynamic-security/v1';
const ANSWER_TIMEOUT_MS = 5000;

// What each kind of client may do. `%u` is the connecting client's own
// username, so one `device` role covers every device.
const ROLES = {
  device: [
    { acltype: 'publishClientSend', topic: 'd/%u/status', allow: true },
    { acltype: 'subscribePattern', topic: 'd/%u/#', allow: true },
  ],
  backend: [
    { acltype: 'publishClientSend', topic: 'd/+/#', allow: true },
    { acltype: 'subscribePattern', topic: 'd/+/status', allow: true },
  ],
};

export async function createDynsec(adminClient) {
  const waiting = new Map(); // correlation ID -> resolve

  adminClient.on('message', (topic, payload) => {
    if (topic !== `${TOPIC}/response`) return;
    for (const answer of JSON.parse(payload.toString()).responses ?? []) {
      waiting.get(answer.correlationData)?.(answer);
    }
  });
  await adminClient.subscribeAsync(`${TOPIC}/response`);

  async function send(command) {
    const correlationData = randomUUID();
    const answered = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.delete(correlationData);
        reject(new Error(`dynsec ${command.command}: no answer`));
      }, ANSWER_TIMEOUT_MS);
      waiting.set(correlationData, (answer) => {
        clearTimeout(timer);
        waiting.delete(correlationData);
        resolve(answer);
      });
    });
    await adminClient.publishAsync(
      TOPIC,
      JSON.stringify({ commands: [{ ...command, correlationData }] }),
    );

    const answer = await answered;
    if (answer.error) throw new Error(`dynsec ${command.command}: ${answer.error}`);
    return answer;
  }

  return {
    async createRoles() {
      for (const [rolename, acls] of Object.entries(ROLES)) {
        await send({ command: 'createRole', rolename, acls });
      }
    },
    createClient(username, password, rolename) {
      return send({ command: 'createClient', username, password, roles: [{ rolename }] });
    },
    deleteClient(username) {
      return send({ command: 'deleteClient', username });
    },
  };
}
