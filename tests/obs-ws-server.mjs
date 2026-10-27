/**
 * Serveur obs-websocket v5 minimal, conforme a la specification du protocole.
 * Il permet de tester le client StreamControl sans installer OBS Studio :
 * poignee de main, defi d'authentification, requetes et evenements.
 *
 * Reference du protocole : https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md
 */
import { WebSocketServer } from 'ws';
import crypto from 'node:crypto';

const OP = { HELLO: 0, IDENTIFY: 1, IDENTIFIED: 2, EVENT: 5, REQUEST: 6, REQUEST_RESPONSE: 7 };

export function buildAuthString(password, salt, challenge) {
  const secret = crypto.createHash('sha256').update(password + salt).digest('base64');
  return crypto.createHash('sha256').update(secret + challenge).digest('base64');
}

/**
 * Demarre un faux OBS.
 * @returns {Promise<{ port:number, close:()=>Promise<void>, state:object, forcePassword:(p:string)=>void }>}
 */
export function startObsServer({ password = '', port = 0 } = {}) {
  const state = {
    scenes: ['Scene principale', 'Scene camera', 'Ecran'],
    currentScene: 'Scene principale',
    streaming: false,
    recording: false,
    /** Simule une sortie mal configuree : StartStream n'active rien. */
    failStream: false,
    /** Sources creees par nom (pour verifier ce que StreamControl demande). */
    inputs: {},
    /** Transformations appliquees aux elements de scene. */
    transforms: [],
    /** Sources reellement presentes dans une scene (nom -> scene). */
    sceneItems: {},
    /** Serveur et cle de diffusion courants. */
    streamService: { server: '', key: '' },
    /** Mode studio : scene en attente et transitions. */
    studioMode: false,
    previewScene: 'Scene camera',
    transition: 'Fade',
    transitionDuration: 300,
    receivedAuth: null,
    requests: [],
  };
  let currentPassword = password;

  const wss = new WebSocketServer({ port, host: '127.0.0.1' });

  const ready = new Promise((resolve) => {
    wss.on('listening', () => resolve(wss.address().port));
  });

  wss.on('connection', (socket) => {
    const salt = crypto.randomBytes(16).toString('base64');
    const challenge = crypto.randomBytes(16).toString('base64');
    const authenticationRequired = currentPassword.length > 0;

    socket.send(
      JSON.stringify({
        op: OP.HELLO,
        d: {
          obsWebSocketVersion: '5.5.2',
          rpcVersion: 1,
          ...(authenticationRequired ? { authentication: { challenge, salt } } : {}),
        },
      }),
    );

    socket.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());

      if (msg.op === OP.IDENTIFY) {
        if (authenticationRequired) {
          const expected = buildAuthString(currentPassword, salt, challenge);
          state.receivedAuth = msg.d.authentication;
          if (msg.d.authentication !== expected) {
            socket.close(4009, 'Authentication failed.');
            return;
          }
        }
        socket.send(JSON.stringify({ op: OP.IDENTIFIED, d: { negotiatedRpcVersion: 1 } }));
        return;
      }

      if (msg.op === OP.REQUEST) {
        const { requestType, requestId } = msg.d;
        state.requests.push(requestType);

        const reply = (responseData, ok = true, code = 100) =>
          socket.send(
            JSON.stringify({
              op: OP.REQUEST_RESPONSE,
              d: { requestType, requestId, requestStatus: { result: ok, code }, responseData },
            }),
          );

        switch (requestType) {
          case 'GetVersion':
            reply({ obsVersion: '31.0.0', obsWebSocketVersion: '5.5.2', rpcVersion: 1 });
            break;
          case 'GetSceneList':
            reply({
              currentProgramSceneName: state.currentScene,
              scenes: [...state.scenes].reverse().map((sceneName) => ({ sceneName })),
            });
            break;
          case 'GetVideoSettings':
            reply({ baseWidth: 1920, baseHeight: 1080, outputWidth: 1920, outputHeight: 1080 });
            break;
          case 'CreateInput':
            if (state.inputs[msg.d.requestData.inputName]) { reply({}, false, 601); break; }
            // Comme OBS : la source existe, mais n'est PAS dans une scene.
            state.inputs[msg.d.requestData.inputName] = { ...msg.d.requestData };
            reply({});
            break;
          case 'CreateSceneItem': {
            const name = msg.d.requestData.sourceName;
            if (state.sceneItems[name]) { reply({}, false, 601); break; }
            state.sceneItems[name] = msg.d.requestData.sceneName;
            reply({ sceneItemId: Object.keys(state.sceneItems).length });
            break;
          }
          case 'GetSceneItemList':
            reply({
              sceneItems: Object.entries(state.sceneItems)
                .filter(([, scene]) => scene === msg.d.requestData.sceneName)
                .map(([sourceName], index) => ({ sourceName, sceneItemId: index + 1 })),
            });
            break;
          case 'RemoveSceneItem': {
            const entry = Object.entries(state.sceneItems).find(
              ([, scene]) => scene === msg.d.requestData.sceneName,
            );
            if (entry) delete state.sceneItems[entry[0]];
            reply({});
            break;
          }
          case 'GetInputList':
            reply({
              inputs: Object.values(state.inputs).map((input) => ({
                inputName: input.inputName,
                inputKind: input.inputKind,
              })),
            });
            break;
          case 'SetInputSettings':
            if (!state.inputs[msg.d.requestData.inputName]) { reply({}, false, 600); break; }
            state.inputs[msg.d.requestData.inputName] = { ...msg.d.requestData };
            reply({});
            break;
          case 'GetSceneItemId':
            // OBS refuse si l'element n'est pas dans la scene (code 600).
            if (!state.sceneItems[msg.d.requestData.sourceName]) {
              reply({}, false, 600, 'No scene items were found in the specified scene by that name or offset.');
              break;
            }
            reply({ sceneItemId: 1 });
            break;
          case 'SaveStreamSettings':
            // Cette requete n'existe pas dans obs-websocket v5.
            reply({}, false, 204, 'Your request type is not valid.');
            break;
          case 'SetSceneItemTransform':
            state.transforms.push(msg.d.requestData.sceneItemTransform);
            reply({});
            break;
          case 'GetStudioModeEnabled':
            reply({ studioModeEnabled: state.studioMode });
            break;
          case 'SetStudioModeEnabled':
            state.studioMode = msg.d.requestData.studioModeEnabled === true;
            reply({});
            broadcast({ op: OP.EVENT, d: { eventType: 'StudioModeStateChanged', eventIntent: 1, eventData: { studioModeEnabled: state.studioMode } } });
            break;
          case 'GetCurrentPreviewScene':
            reply({ currentPreviewSceneName: state.previewScene });
            break;
          case 'SetCurrentPreviewScene':
            if (!state.scenes.includes(msg.d.requestData.sceneName)) { reply({}, false, 600); break; }
            state.previewScene = msg.d.requestData.sceneName;
            reply({});
            broadcast({ op: OP.EVENT, d: { eventType: 'CurrentPreviewSceneChanged', eventIntent: 4, eventData: { sceneName: state.previewScene } } });
            break;
          case 'TriggerStudioModeTransition':
            if (!state.studioMode) { reply({}, false, 506); break; }
            state.currentScene = state.previewScene;
            reply({});
            broadcast({ op: OP.EVENT, d: { eventType: 'CurrentProgramSceneChanged', eventIntent: 4, eventData: { sceneName: state.currentScene } } });
            break;
          case 'GetSceneTransitionList':
            reply({
              transitions: [{ transitionName: 'Fade' }, { transitionName: 'Cut' }],
              currentSceneTransitionName: state.transition,
              currentSceneTransitionDuration: state.transitionDuration,
            });
            break;
          case 'SetCurrentSceneTransition':
            state.transition = msg.d.requestData.transitionName;
            reply({});
            broadcast({ op: OP.EVENT, d: { eventType: 'CurrentSceneTransitionChanged', eventIntent: 1, eventData: {} } });
            break;
          case 'SetCurrentSceneTransitionDuration':
            state.transitionDuration = msg.d.requestData.transitionDuration;
            reply({});
            break;
          case 'GetStreamStatus':
            reply({ outputActive: state.streaming, outputReconnecting: false });
            break;
          case 'SetStreamServiceSettings':
            state.streamService = { ...msg.d.requestData.streamServiceSettings };
            reply({});
            break;
          case 'GetStreamServiceSettings':
            reply({
              streamServiceType: 'rtmp_custom',
              streamServiceSettings: state.streamService,
            });
            break;
          case 'GetRecordStatus':
            reply({ outputActive: state.recording, outputPaused: false });
            break;
          case 'SetCurrentProgramScene':
            if (!state.scenes.includes(msg.d.requestData.sceneName)) {
              reply({}, false, 600);
              break;
            }
            state.currentScene = msg.d.requestData.sceneName;
            reply({});
            broadcast({ op: OP.EVENT, d: { eventType: 'CurrentProgramSceneChanged', eventIntent: 4, eventData: { sceneName: state.currentScene } } });
            break;
          case 'CreateScene':
            if (state.scenes.includes(msg.d.requestData.sceneName)) { reply({}, false, 601); break; }
            state.scenes.push(msg.d.requestData.sceneName);
            reply({});
            broadcast({ op: OP.EVENT, d: { eventType: 'SceneCreated', eventIntent: 1, eventData: { sceneName: msg.d.requestData.sceneName } } });
            broadcast({ op: OP.EVENT, d: { eventType: 'SceneListChanged', eventIntent: 1, eventData: {} } });
            break;
          case 'RemoveScene':
            state.scenes = state.scenes.filter((name) => name !== msg.d.requestData.sceneName);
            reply({});
            broadcast({ op: OP.EVENT, d: { eventType: 'SceneRemoved', eventIntent: 1, eventData: { sceneName: msg.d.requestData.sceneName } } });
            broadcast({ op: OP.EVENT, d: { eventType: 'SceneListChanged', eventIntent: 1, eventData: {} } });
            break;
          case 'StartStream':
            if (state.streaming) { reply({}, false, 500); break; }
            // `failStream` simule une sortie mal configuree : OBS accepte la
            // requete mais la sortie ne demarre jamais.
            if (state.failStream || !state.streamService.server) { reply({}); break; }
            state.streaming = true;
            reply({});
            broadcast({ op: OP.EVENT, d: { eventType: 'StreamStateChanged', eventIntent: 64, eventData: { outputActive: true } } });
            break;
          case 'StopStream':
            state.streaming = false;
            reply({});
            broadcast({ op: OP.EVENT, d: { eventType: 'StreamStateChanged', eventIntent: 64, eventData: { outputActive: false } } });
            break;
          case 'StartRecord':
            state.recording = true;
            reply({});
            broadcast({ op: OP.EVENT, d: { eventType: 'RecordStateChanged', eventIntent: 128, eventData: { outputActive: true } } });
            break;
          case 'StopRecord':
            state.recording = false;
            reply({});
            broadcast({ op: OP.EVENT, d: { eventType: 'RecordStateChanged', eventIntent: 128, eventData: { outputActive: false } } });
            break;
          default:
            reply({}, false, 204); // RequestType not supported
        }
      }
    });
  });

  const broadcast = (payload) => {
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(JSON.stringify(payload));
    }
  };

  return {
    port: ready,
    state,
    forcePassword: (value) => { currentPassword = value; },
    close: () =>
      new Promise((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(resolve);
      }),
  };
}
