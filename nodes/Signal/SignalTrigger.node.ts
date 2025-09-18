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
                displayName: 'Only With Text',
                name: 'onlyWithText',
                type: 'boolean',
                default: true,
                description: 'Retrieve only messages with text content',
            },
            {
                displayName: 'Only With Attachments',
                name: 'onlyWithAttachments',
                type: 'boolean',
                default: false,
                description: 'Retrieve only messages with attachments',
            },
            {
                displayName: 'Only With Reactions',
                name: 'onlyWithReactions',
                type: 'boolean',
                default: false,
                description: 'Retrieve only messages with reactions',
            },
        ],
    };

    async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
        const credentials = await this.getCredentials('signalApi');
        const apiUrl = credentials.apiUrl as string;
        const apiToken = credentials.apiToken as string;
        const phoneNumber = credentials.phoneNumber as string;
        const reconnectDelay = (this.getNodeParameter('reconnectDelay', 0) as number) * 1000;
        const onlyWithText = this.getNodeParameter('onlyWithText', 0) as boolean;
        const onlyWithAttachments = this.getNodeParameter('onlyWithAttachments', 0) as boolean;
        const onlyWithReactions = this.getNodeParameter('onlyWithReactions', 0) as boolean;

        const wsUrl = `${apiUrl.replace('http', 'ws')}/v1/receive/${phoneNumber}`;
        const processedMessages = new Set<number>();
        const maxMessages = 1000;

        const connectWebSocket = () => {
            const ws = new WebSocket(wsUrl, {
                headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
            });

            ws.on('message', (data: Buffer) => {
                try {
                    const message = JSON.parse(data.toString());
                    this.logger.debug(`SignalTrigger: Received message: ${JSON.stringify(message, null, 2)}`);

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
                    const processedMessage = {
                        messageText: dataMsg.message || '',
                        attachments: dataMsg.attachments || [],
                        reactions: dataMsg.reactions || [],
                        sourceNumber: message.envelope?.sourceNumber || '',
                        timestamp: timestamp,
                        account: message.account || '',
                    };

                    // Ігнорувати події без вмісту
                    if (!processedMessage.messageText && 
                        processedMessage.attachments.length === 0 && 
                        processedMessage.reactions.length === 0) {
                        this.logger.debug(`SignalTrigger: Skipping empty message with timestamp ${timestamp}`);
                        return;
                    }

                    // Фільтрація за параметрами
                    if ((onlyWithText && !processedMessage.messageText) || 
                        (onlyWithAttachments && processedMessage.attachments.length === 0) || 
                        (onlyWithReactions && processedMessage.reactions.length === 0)) {
                        this.logger.debug(`SignalTrigger: Skipping filtered message with timestamp ${timestamp}`);
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
                this.logger.debug(`SignalTrigger: Connected to ${wsUrl}`);
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