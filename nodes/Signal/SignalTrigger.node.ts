import {
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
    ITriggerFunctions,
    ITriggerResponse,
    NodeApiError,
} from 'n8n-workflow';
import { WebSocket } from 'ws';

export class SignalTrigger implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Signal Trigger',
        name: 'signalTrigger',
        icon: 'file:signal.svg',
        group: ['trigger'],
        version: 1,
        description: 'Triggers on new Signal messages via signal-cli-rest-api WebSocket',
        defaults: {
            name: 'Signal Trigger',
        },
        inputs: [],
        outputs: ['main'],
        credentials: [
            {
                name: 'signalApi',
                required: true,
            },
        ],
        properties: [
            {
                displayName: 'Reconnect Delay (seconds)',
                name: 'reconnectDelay',
                type: 'number',
                default: 5,
                description: 'Delay before reconnecting on close (in seconds)',
                typeOptions: {
                    minValue: 1,
                    maxValue: 60,
                },
            },
            {
                displayName: 'Ignore Messages',
                name: 'ignoreMessages',
                type: 'boolean',
                default: false,
                description: 'Enable to ignore messages with text content',
            },
            {
                displayName: 'Ignore Attachments',
                name: 'ignoreAttachments',
                type: 'boolean',
                default: false,
                description: 'Enable to ignore messages with attachments',
            },
            {
                displayName: 'Ignore Reactions',
                name: 'ignoreReactions',
                type: 'boolean',
                default: false,
                description: 'Enable to ignore messages with reactions',
            },
        ],
    };

    async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
        const credentials = await this.getCredentials('signalApi');
        const apiUrl = credentials.apiUrl as string;
        const apiToken = credentials.apiToken as string;
        const phoneNumber = credentials.phoneNumber as string;
        const reconnectDelay = (this.getNodeParameter('reconnectDelay', 0) as number) * 1000;
        const ignoreMessages = this.getNodeParameter('ignoreMessages', 0) as boolean;
        const ignoreAttachments = this.getNodeParameter('ignoreAttachments', 0) as boolean;
        const ignoreReactions = this.getNodeParameter('ignoreReactions', 0) as boolean;

        const wsUrl = `${apiUrl.replace('http', 'ws')}/v1/receive/${phoneNumber}`;
        this.logger.debug(`SignalTrigger: Attempting to connect to WS URL: ${wsUrl}`);
        const processedMessages = new Set<number>();
        const maxMessages = 1000;

        const connectWebSocket = () => {
            const ws = new WebSocket(wsUrl, {
                headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
            });

            ws.on('open', () => {
                this.logger.debug(`SignalTrigger: Successfully connected to ${wsUrl}`);
            });

            ws.on('message', (data: Buffer) => {
                try {
                    const message = JSON.parse(data.toString());
                    this.logger.debug(`SignalTrigger: Received raw message: ${JSON.stringify(message, null, 2)}`);

                    const timestamp = message.envelope?.timestamp || 0;
                    if (processedMessages.has(timestamp)) {
                        this.logger.debug(`SignalTrigger: Skipping duplicate message with timestamp ${timestamp}`);
                        return;
                    }
                    if (processedMessages.size >= maxMessages) {
                        processedMessages.clear();
                    }
                    processedMessages.add(timestamp);

                    const dataMsg = message.envelope?.dataMessage || message.envelope?.syncMessage?.sentMessage || {};
                    
                    const hasDataMessage = !!message.envelope?.dataMessage;
                    const hasSyncMessage = !!message.envelope?.syncMessage;
                    
                    let shouldProcess = false;
                    let messageType = 'unknown';
                    
                    if (hasDataMessage) {
                        // Вхідне повідомлення - обробляємо
                        shouldProcess = true;
                        messageType = 'incoming';
                        this.logger.debug(`SignalTrigger: Incoming message detected`);
                    } else if (hasSyncMessage) {
                        const sentMessage = message.envelope.syncMessage.sentMessage;
                        const sourceUuid = message.envelope.sourceUuid;
                        const destinationUuid = sentMessage?.destinationUuid;
                        
                        if (sourceUuid === destinationUuid) {
                            // Повідомлення самому собі - обробляємо
                            shouldProcess = true;
                            messageType = 'self_note';
                            this.logger.debug(`SignalTrigger: Self note detected`);
                        } else {
                            // Вихідне повідомлення комусь - НЕ обробляємо
                            shouldProcess = false;
                            messageType = 'outgoing';
                            this.logger.debug(`SignalTrigger: Outgoing message detected - skipping`);
                        }
                    }
                    
                    if (!shouldProcess) {
                        this.logger.debug(`SignalTrigger: Skipping message type: ${messageType} with timestamp ${timestamp}`);
                        return;
                    }
                    
                    const processedMessage = {
                        messageText: dataMsg.message || '',
                        attachments: dataMsg.attachments || [],
                        reactions: dataMsg.reactions || [],
                        sourceNumber: message.envelope?.sourceNumber || '',
                        sourceUuid: message.envelope?.sourceUuid || '',
                        sourceName: message.envelope?.sourceName || '',
                        timestamp: timestamp,
                        serverReceivedTimestamp: message.envelope?.serverReceivedTimestamp || 0,
                        serverDeliveredTimestamp: message.envelope?.serverDeliveredTimestamp || 0,
                        account: message.account || '',
                        hasContent: message.envelope?.hasContent || false,
                        isUnidentifiedSender: message.envelope?.isUnidentifiedSender || false,
                        messageType: messageType,
                        envelope: message.envelope || {},
                    };

                    this.logger.debug(`SignalTrigger: Processed message content: ${JSON.stringify(processedMessage, null, 2)}`);

                    if (!processedMessage.messageText && 
                        processedMessage.attachments.length === 0 && 
                        processedMessage.reactions.length === 0) {
                        this.logger.debug(`SignalTrigger: Skipping empty message with timestamp ${timestamp}`);
                        return;
                    }

                    if ((ignoreMessages && processedMessage.messageText) ||
                        (ignoreAttachments && processedMessage.attachments.length > 0) ||
                        (ignoreReactions && processedMessage.reactions.length > 0)) {
                        this.logger.debug(`SignalTrigger: Ignoring message with timestamp ${timestamp} due to filter`);
                        return;
                    }

                    const returnData: INodeExecutionData = {
                        json: processedMessage as any,
                    };
                    this.emit([this.helpers.returnJsonArray([returnData])]);
                    this.logger.debug(`SignalTrigger: Emitted message with timestamp ${timestamp}`);
                } catch (error) {
                    this.logger.error('SignalTrigger: Error parsing message', { error });
                }
            });

            ws.on('error', (error: Error) => {
                this.logger.error('SignalTrigger: WebSocket error', { error });
                setTimeout(connectWebSocket, reconnectDelay);
            });

            ws.on('close', (code, reason) => {
                this.logger.debug(`SignalTrigger: WebSocket closed with code ${code}, reason: ${reason.toString()}`);
                setTimeout(connectWebSocket, reconnectDelay);
            });

            return ws;
        };

        const ws = connectWebSocket();

        return new Promise((resolve, reject) => {
            ws.on('open', () => {
                this.logger.debug(`SignalTrigger: Initial connection to ${wsUrl}`);
                resolve({
                    closeFunction: async () => {
                        ws.close();
                        this.logger.debug('SignalTrigger: WebSocket closed');
                    },
                });
            });

            ws.on('error', (error: Error) => {
                this.logger.error('SignalTrigger: WebSocket connection failed', { error });
                setTimeout(connectWebSocket, reconnectDelay);
            });
        });
    }
}