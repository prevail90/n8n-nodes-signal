import {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
} from 'n8n-workflow';
import { executeMessagesOperation } from './messages';
import { executeGroupsOperation } from './groups';
import { executeContactsOperation } from './contacts';

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
                default: '',
                options: [
                    {
                        name: 'Messages: Send Message',
                        value: 'sendMessage',
                        description: 'Send a text message to a contact or group',
                        action: 'Send a text message',
                    },
                    {
                        name: 'Messages: Send Attachment',
                        value: 'sendAttachment',
                        description: 'Send a file or image to a contact or group',
                        action: 'Send an attachment',
                    },
                    {
                        name: 'Messages: Send Reaction',
                        value: 'sendReaction',
                        description: 'Send a reaction (emoji) to a message',
                        action: 'Send a reaction',
                    },
                    {
                        name: 'Messages: Remove Reaction',
                        value: 'removeReaction',
                        description: 'Remove a reaction from a message',
                        action: 'Remove a reaction',
                    },
                    {
                        name: 'Contacts: Get Contacts',
                        value: 'getContacts',
                        description: 'Get the list of contacts for the account',
                        action: 'Get contacts',
                    },
                    {
                        name: 'Groups: Get Groups',
                        value: 'getGroups',
                        description: 'Get the list of groups for the account',
                        action: 'Get groups',
                    },
                    {
                        name: 'Groups: Create Group',
                        value: 'createGroup',
                        description: 'Create a new Signal group',
                        action: 'Create a group',
                    },
                ],
            },
            {
                displayName: 'Recipient',
                name: 'recipient',
                type: 'string',
                default: '',
                placeholder: '+1234567890 or groupId',
                description: 'Phone number or group ID to send the message, attachment, or reaction to',
                required: true,
                displayOptions: {
                    show: {
                        operation: ['sendMessage', 'sendAttachment', 'sendReaction', 'removeReaction'],
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
                type: 'options',
                default: '👍',
                description: 'Emoji to send as a reaction (select or enter custom emoji)',
                required: true,
                typeOptions: {
                    allowCustom: true,
                },
                options: [
                    {
                        name: 'Thumbs Up',
                        value: '👍',
                    },
                    {
                        name: 'Heart',
                        value: '❤️',
                    },
                    {
                        name: 'Smile',
                        value: '😄',
                    },
                    {
                        name: 'Sad',
                        value: '😢',
                    },
                    {
                        name: 'Angry',
                        value: '😣',
                    },
                    {
                        name: 'Star',
                        value: '⭐',
                    },
                    {
                        name: 'Fire',
                        value: '🔥',
                    },
                    {
                        name: 'Plus',
                        value: '➕',
                    },
                    {
                        name: 'Minus',
                        value: '➖',
                    },
                    {
                        name: 'Handshake',
                        value: '🤝',
                    },
                ],
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
                        operation: ['sendReaction', 'removeReaction'],
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
                        operation: ['sendReaction', 'removeReaction'],
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
                        operation: ['sendMessage', 'sendAttachment', 'sendReaction', 'removeReaction', 'getContacts', 'getGroups', 'createGroup'],
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
            const params = {
                recipient: this.getNodeParameter('recipient', i, '') as string,
                message: this.getNodeParameter('message', i, '') as string,
                attachmentUrl: this.getNodeParameter('attachmentUrl', i, '') as string,
                groupName: this.getNodeParameter('groupName', i, '') as string,
                groupMembers: this.getNodeParameter('groupMembers', i, '') as string,
                emoji: this.getNodeParameter('emoji', i, '') as string,
                targetAuthor: this.getNodeParameter('targetAuthor', i, '') as string,
                targetSentTimestamp: this.getNodeParameter('targetSentTimestamp', i, 0) as number,
                timeout,
                apiUrl,
                apiToken,
                phoneNumber,
            };

            try {
                if (['sendMessage', 'sendAttachment', 'sendReaction', 'removeReaction'].includes(operation)) {
                    const result = await executeMessagesOperation.call(this, operation, i, params);
                    returnData.push(result);
                } else if (['getGroups', 'createGroup'].includes(operation)) {
                    const result = await executeGroupsOperation.call(this, operation, i, params);
                    returnData.push(result);
                } else if (operation === 'getContacts') {
                    const result = await executeContactsOperation.call(this, operation, i, params);
                    returnData.push(result);
                }
            } catch (error) {
                throw error;
            }
        }

        return [returnData];
    }
}