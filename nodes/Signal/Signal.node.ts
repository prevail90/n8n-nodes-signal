import {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
    NodeApiError,
} from 'n8n-workflow';
import { AxiosError, AxiosRequestConfig } from 'axios';
import axios from 'axios';

interface SignalApiErrorResponse {
    error?: string;
}

export class Signal implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Signal',
        name: 'signal',
        icon: 'file:signal.svg',
        group: ['output'],
        version: 1,
        description: 'Interact with Signal via signal-cli-rest-api',
        defaults: {
            name: 'Signal',
        },
        inputs: ['main'],
        outputs: ['main'],
        credentials: [
            {
                name: 'signalApi',
                required: true,
            },
        ],
        properties: [
            {
                displayName: 'Operation',
                name: 'operation',
                type: 'options',
                noDataExpression: true,
                default: 'sendMessage',
                options: [
                    {
                        name: 'Send Message',
                        value: 'sendMessage',
                        description: 'Send a text message to a contact or group',
                        action: 'Send a text message',
                    },
                    {
                        name: 'Get Contacts',
                        value: 'getContacts',
                        description: 'Get the list of contacts for the account',
                        action: 'Get contacts',
                    },
                    {
                        name: 'Get Groups',
                        value: 'getGroups',
                        description: 'Get the list of groups for the account',
                        action: 'Get groups',
                    },
                    {
                        name: 'Send Attachment',
                        value: 'sendAttachment',
                        description: 'Send a file or image to a contact or group',
                        action: 'Send an attachment',
                    },
                    {
                        name: 'Create Group',
                        value: 'createGroup',
                        description: 'Create a new Signal group',
                        action: 'Create a group',
                    },
                    {
                        name: 'Send Reaction',
                        value: 'sendReaction',
                        description: 'Send a reaction (emoji) to a message',
                        action: 'Send a reaction',
                    },
                ],
            },
            {
                displayName: 'Recipient',
                name: 'recipient',
                type: 'string',
                default: '',
                placeholder: '+1234567890 or groupId',
                description: 'Phone number or group ID to send the message or attachment to',
                required: true,
                displayOptions: {
                    show: {
                        operation: ['sendMessage', 'sendAttachment', 'sendReaction'],
                    },
                },
            },
            {
                displayName: 'Message',
                name: 'message',
                type: 'string',
                default: '',
                description: 'The text message to send (optional for attachments)',
                displayOptions: {
                    show: {
                        operation: ['sendMessage', 'sendAttachment'],
                    },
                },
            },
            {
                displayName: 'Attachment URL',
                name: 'attachmentUrl',
                type: 'string',
                default: '',
                placeholder: 'https://example.com/image.jpg',
                description: 'URL of the file or image to send (e.g., PNG, JPG, PDF, MP3 for voice notes)',
                required: true,
                displayOptions: {
                    show: {
                        operation: ['sendAttachment'],
                    },
                },
            },
            {
                displayName: 'Group Name',
                name: 'groupName',
                type: 'string',
                default: '',
                description: 'Name of the new group',
                required: true,
                displayOptions: {
                    show: {
                        operation: ['createGroup'],
                    },
                },
            },
            {
                displayName: 'Group Members',
                name: 'groupMembers',
                type: 'string',
                default: '',
                placeholder: '+1234567890,+0987654321',
                description: 'Comma-separated list of phone numbers to add to the group',
                required: true,
                displayOptions: {
                    show: {
                        operation: ['createGroup'],
                    },
                },
            },
            {
                displayName: 'Emoji',
                name: 'emoji',
                type: 'string',
                default: '',
                placeholder: '👍',
                description: 'Emoji to send as a reaction',
                required: true,
                displayOptions: {
                    show: {
                        operation: ['sendReaction'],
                    },
                },
            },
            {
                displayName: 'Target Author',
                name: 'targetAuthor',
                type: 'string',
                default: '',
                placeholder: '+1234567890',
                description: 'Phone number of the message author to react to',
                required: true,
                displayOptions: {
                    show: {
                        operation: ['sendReaction'],
                    },
                },
            },
            {
                displayName: 'Target Message Timestamp',
                name: 'targetSentTimestamp',
                type: 'number',
                default: 0,
                description: 'Timestamp of the message to react to (in milliseconds)',
                required: true,
                displayOptions: {
                    show: {
                        operation: ['sendReaction'],
                    },
                },
            },
            {
                displayName: 'Timeout (seconds)',
                name: 'timeout',
                type: 'number',
                default: 60,
                description: 'Request timeout in seconds (set higher for Get Groups, e.g., 300)',
                displayOptions: {
                    show: {
                        operation: ['sendMessage', 'getContacts', 'getGroups', 'sendAttachment', 'createGroup', 'sendReaction'],
                    },
                },
                typeOptions: {
                    minValue: 1,
                    maxValue: 600,
                },
                hint: 'Increase for slow operations like Get Groups (recommended: 300 for Get Groups)',
            },
        ],
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const returnData: INodeExecutionData[] = [];
        const operation = this.getNodeParameter('operation', 0) as string;

        const credentials = await this.getCredentials('signalApi');
        const apiUrl = credentials.apiUrl as string;
        const apiToken = credentials.apiToken as string;
        const phoneNumber = credentials.phoneNumber as string;

        for (let i = 0; i < items.length; i++) {
            const timeout = (this.getNodeParameter('timeout', i, operation === 'getGroups' ? 300 : 60) as number) * 1000;
            const axiosConfig: AxiosRequestConfig = {
                headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
                timeout,
            };

            const retryRequest = async (request: () => Promise<any>, retries = 2, delay = 5000): Promise<any> => {
                for (let attempt = 1; attempt <= retries; attempt++) {
                    try {
                        return await request();
                    } catch (error) {
                        if (attempt === retries) throw error;
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                }
            };

            try {
                if (operation === 'sendMessage') {
                    const recipient = this.getNodeParameter('recipient', i) as string;
                    const message = this.getNodeParameter('message', i) as string;

                    const response = await retryRequest(() =>
                        axios.post(
                            `${apiUrl}/v1/send`,
                            {
                                message,
                                number: phoneNumber,
                                recipients: [recipient],
                            },
                            axiosConfig
                        )
                    );

                    returnData.push({
                        json: response.data,
                        pairedItem: { item: i },
                    });
                } else if (operation === 'getContacts') {
                    const response = await retryRequest(() =>
                        axios.get(`${apiUrl}/v1/contacts/${phoneNumber}`, axiosConfig)
                    );

                    returnData.push({
                        json: response.data,
                        pairedItem: { item: i },
                    });
                } else if (operation === 'getGroups') {
                    const response = await retryRequest(() =>
                        axios.get(`${apiUrl}/v1/groups/${phoneNumber}`, axiosConfig)
                    );

                    returnData.push({
                        json: response.data,
                        pairedItem: { item: i },
                    });
                } else if (operation === 'sendAttachment') {
                    const recipient = this.getNodeParameter('recipient', i) as string;
                    const message = this.getNodeParameter('message', i) as string;
                    const attachmentUrl = this.getNodeParameter('attachmentUrl', i) as string;

                    const response = await retryRequest(() =>
                        axios.post(
                            `${apiUrl}/v1/send`,
                            {
                                message,
                                number: phoneNumber,
                                recipients: [recipient],
                                attachments: [attachmentUrl],
                            },
                            axiosConfig
                        )
                    );

                    returnData.push({
                        json: response.data,
                        pairedItem: { item: i },
                    });
                } else if (operation === 'createGroup') {
                    const groupName = this.getNodeParameter('groupName', i) as string;
                    const groupMembers = (this.getNodeParameter('groupMembers', i) as string)
                        .split(',')
                        .map(member => member.trim());

                    const response = await retryRequest(() =>
                        axios.post(
                            `${apiUrl}/v1/groups/${phoneNumber}`,
                            {
                                name: groupName,
                                members: groupMembers,
                            },
                            axiosConfig
                        )
                    );

                    returnData.push({
                        json: response.data,
                        pairedItem: { item: i },
                    });
                } else if (operation === 'sendReaction') {
                    const recipient = this.getNodeParameter('recipient', i) as string;
                    const emoji = this.getNodeParameter('emoji', i) as string;
                    const targetAuthor = this.getNodeParameter('targetAuthor', i) as string;
                    const targetSentTimestamp = this.getNodeParameter('targetSentTimestamp', i) as number;

                    const response = await retryRequest(() =>
                        axios.post(
                            `${apiUrl}/v1/reactions/${phoneNumber}`,
                            {
                                reaction: emoji,
                                recipient: recipient,
                                target_author: targetAuthor,
                                timestamp: targetSentTimestamp,
                            },
                            axiosConfig
                        )
                    );

                    returnData.push({
                        json: response.data,
                        pairedItem: { item: i },
                    });
                }
            } catch (error) {
                const axiosError = error as AxiosError<SignalApiErrorResponse>;
                throw new NodeApiError(this.getNode(), {
                    message: axiosError.message,
                    description: (axiosError.response?.data?.error || axiosError.message) as string,
                    httpCode: axiosError.response?.status?.toString() || 'unknown',
                }, {
                    itemIndex: i,
                });
            }
        }

        return [returnData];
    }
}