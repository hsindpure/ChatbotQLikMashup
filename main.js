define([
    'jquery',
    'qlik',
    './properties',
    'text!./template.html',
    'text!./style.css'
], function($, qlik, props, template, cssContent) {
    'use strict';

    // Add CSS to document head
    $('<style>').html(cssContent).appendTo('head');

    return {
        template: template,
        definition: props,
        
        controller: ['$scope', '$element', function($scope, $element) {
            const app = qlik.currApp();
            let hypercubeData = {};
            let chatHistory = [];
            let currentUser = 'User'; // This should be fetched from QlikSense session
            let selectedRole = 'Analyst';
            let isListening = false;
            let recognition;

            // Initialize Speech Recognition
            if ('webkitSpeechRecognition' in window) {
                recognition = new webkitSpeechRecognition();
                recognition.continuous = false;
                recognition.interimResults = false;
                recognition.lang = 'en-US';
            }

            // Fetch app data on initialization
            $scope.$watch('layout', function(newVal) {
                if (newVal) {
                    fetchAppData();
                    initializeChatbot();
                }
            });

            function fetchAppData() {
                // Get app info
                app.getAppLayout().then(function(layout) {
                    $scope.appName = layout.qTitle || 'QlikSense App';
                    $scope.$apply();
                });

                // Create hypercube to fetch all app data
                const hypercubeDef = {
                    qDimensions: [],
                    qMeasures: [],
                    qInitialDataFetch: [{
                        qTop: 0,
                        qLeft: 0,
                        qHeight: 1000,
                        qWidth: 50
                    }]
                };

                // Get all fields and create dimensions/measures
                app.getList('FieldList').then(function(reply) {
                    const fields = reply.qFieldList.qItems;
                    
                    fields.forEach(function(field, index) {
                        if (index < 20) { // Limit to prevent too much data
                            if (field.qCardinal < 100) { // Use as dimension if low cardinality
                                hypercubeDef.qDimensions.push({
                                    qDef: {
                                        qFieldDefs: [field.qName],
                                        qSortCriterias: [{
                                            qSortByState: 1,
                                            qSortByAscii: 1
                                        }]
                                    }
                                });
                            } else { // Use as measure if high cardinality
                                hypercubeDef.qMeasures.push({
                                    qDef: {
                                        qDef: `Sum([${field.qName}])`,
                                        qLabel: field.qName
                                    }
                                });
                            }
                        }
                    });

                    // Create hypercube object
                    app.createCube(hypercubeDef).then(function(model) {
                        model.getLayout().then(function(layout) {
                            hypercubeData = {
                                dimensions: layout.qHyperCube.qDimensionInfo,
                                measures: layout.qHyperCube.qMeasureInfo,
                                data: layout.qHyperCube.qDataPages[0] ? layout.qHyperCube.qDataPages[0].qMatrix : []
                            };
                        });
                    });
                });
            }

            function initializeChatbot() {
                const $chatbot = $element.find('.chatbot-container');
                const $toggle = $element.find('.chatbot-toggle');
                const $close = $element.find('.chatbot-close');
                const $sendBtn = $element.find('.send-button');
                const $input = $element.find('.chat-input');
                const $voiceBtn = $element.find('.voice-button');
                const $roleSelect = $element.find('.role-select');
                const $downloadBtn = $element.find('.download-history');

                // Toggle chatbot
                $toggle.on('click', function() {
                    $chatbot.addClass('active');
                    $input.focus();
                });

                // Close chatbot
                $close.on('click', function() {
                    $chatbot.removeClass('active');
                });

                // Send message
                $sendBtn.on('click', sendMessage);
                $input.on('keypress', function(e) {
                    if (e.which === 13) {
                        sendMessage();
                    }
                });

                // Voice input
                $voiceBtn.on('click', toggleVoiceInput);

                // Role selection
                $roleSelect.on('change', function() {
                    selectedRole = $(this).val();
                    addMessage('system', `Role changed to: ${selectedRole}`);
                });

                // Download history
                $downloadBtn.on('click', downloadChatHistory);

                // Initialize with welcome message
                addMessage('bot', `Hello! I'm your AI assistant for ${$scope.appName || 'this QlikSense app'}. How can I help you analyze your data today?`);
            }

            function sendMessage() {
                const $input = $element.find('.chat-input');
                const message = $input.val().trim();
                
                if (!message) return;

                // Add user message
                addMessage('user', message);
                $input.val('');

                // Show typing indicator
                showTypingIndicator();

                // Send to AI API
                processWithAI(message);
            }

            function processWithAI(query) {
                const payload = {
                    prompt: `You are a ${selectedRole} assistant for QlikSense data analysis. Analyze the provided data and answer the user's question. If the user asks for charts or tables, respond with a JSON structure that can be used to create visualizations.`,
                    data: hypercubeData,
                    query: query,
                    role: selectedRole,
                    appName: $scope.appName
                };

                // Replace with your actual AI API endpoint
                $.ajax({
                    url: 'YOUR_AI_API_ENDPOINT', // Replace with actual endpoint
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer YOUR_API_KEY' // Replace with actual API key
                    },
                    data: JSON.stringify(payload),
                    success: function(response) {
                        hideTypingIndicator();
                        
                        let aiResponse = response.answer || response.message || 'I apologize, but I cannot process your request at the moment.';
                        
                        // Check if response contains chart/table data
                        if (response.chart || response.table) {
                            aiResponse += '\n\n' + generateVisualization(response.chart || response.table);
                        }
                        
                        addMessage('bot', aiResponse);
                        
                        // Apply any QlikSense actions if suggested
                        if (response.qlikActions) {
                            executeQlikActions(response.qlikActions);
                        }
                    },
                    error: function() {
                        hideTypingIndicator();
                        addMessage('bot', 'I apologize, but I encountered an error processing your request. Please try again.');
                    }
                });
            }

            function executeQlikActions(actions) {
                actions.forEach(function(action) {
                    switch(action.type) {
                        case 'clearSelections':
                            app.clearAll();
                            break;
                        case 'selectValues':
                            app.field(action.field).selectValues(action.values);
                            break;
                        case 'selectPossible':
                            app.field(action.field).selectPossible();
                            break;
                        case 'selectAlternative':
                            app.field(action.field).selectAlternative();
                            break;
                    }
                });
            }

            function generateVisualization(data) {
                // This would generate HTML for charts/tables
                // For now, return a simple table structure
                if (data.type === 'table') {
                    let html = '<div class="ai-table"><table class="data-table">';
                    
                    // Headers
                    html += '<thead><tr>';
                    data.headers.forEach(function(header) {
                        html += `<th>${header}</th>`;
                    });
                    html += '</tr></thead>';
                    
                    // Data rows
                    html += '<tbody>';
                    data.rows.forEach(function(row) {
                        html += '<tr>';
                        row.forEach(function(cell) {
                            html += `<td>${cell}</td>`;
                        });
                        html += '</tr>';
                    });
                    html += '</tbody></table></div>';
                    
                    return html;
                }
                
                return '<div class="visualization-placeholder">Chart visualization would appear here</div>';
            }

            function addMessage(type, message) {
                const $messages = $element.find('.chat-messages');
                const timestamp = new Date().toLocaleTimeString();
                
                const messageObj = {
                    type: type,
                    message: message,
                    timestamp: timestamp,
                    user: type === 'user' ? currentUser : 'AI Assistant',
                    role: selectedRole
                };
                
                chatHistory.push(messageObj);
                
                let messageHtml;
                if (type === 'user') {
                    messageHtml = `
                        <div class="message user-message">
                            <div class="message-content">
                                <div class="message-header">
                                    <span class="user-icon">👤</span>
                                    <span class="user-name">${currentUser}</span>
                                    <span class="timestamp">${timestamp}</span>
                                </div>
                                <div class="message-text">${message}</div>
                            </div>
                        </div>
                    `;
                } else {
                    messageHtml = `
                        <div class="message bot-message">
                            <div class="message-content">
                                <div class="message-header">
                                    <span class="bot-icon">🤖</span>
                                    <span class="bot-name">AI Assistant (${selectedRole})</span>
                                    <span class="timestamp">${timestamp}</span>
                                </div>
                                <div class="message-text">${message}</div>
                            </div>
                        </div>
                    `;
                }
                
                $messages.append(messageHtml);
                $messages.scrollTop($messages[0].scrollHeight);
            }

            function showTypingIndicator() {
                const $messages = $element.find('.chat-messages');
                $messages.append(`
                    <div class="message bot-message typing-indicator">
                        <div class="message-content">
                            <div class="typing-animation">
                                <span></span>
                                <span></span>
                                <span></span>
                            </div>
                        </div>
                    </div>
                `);
                $messages.scrollTop($messages[0].scrollHeight);
            }

            function hideTypingIndicator() {
                $element.find('.typing-indicator').remove();
            }

            function toggleVoiceInput() {
                if (!recognition) {
                    addMessage('system', 'Voice recognition is not supported in your browser.');
                    return;
                }

                if (isListening) {
                    recognition.stop();
                    isListening = false;
                    $element.find('.voice-button').removeClass('listening');
                } else {
                    recognition.start();
                    isListening = true;
                    $element.find('.voice-button').addClass('listening');
                }
            }

            if (recognition) {
                recognition.onresult = function(event) {
                    const transcript = event.results[0][0].transcript;
                    $element.find('.chat-input').val(transcript);
                    isListening = false;
                    $element.find('.voice-button').removeClass('listening');
                };

                recognition.onerror = function() {
                    isListening = false;
                    $element.find('.voice-button').removeClass('listening');
                    addMessage('system', 'Voice recognition error. Please try again.');
                };
            }

            function downloadChatHistory() {
                // Create PDF content
                const pdfContent = chatHistory.map(msg => 
                    `[${msg.timestamp}] ${msg.user}: ${msg.message}`
                ).join('\n\n');

                // Create and download file
                const blob = new Blob([pdfContent], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `chatbot_history_${new Date().toISOString().split('T')[0]}.txt`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }

            // QlikSense Capability API functions
            $scope.clearAllSelections = function() {
                app.clearAll();
                addMessage('system', 'All selections cleared.');
            };

            $scope.getSelectionState = function() {
                app.getList('SelectionObject').then(function(reply) {
                    const selections = reply.qSelectionObject.qSelections;
                    if (selections.length > 0) {
                        const selectionText = selections.map(s => 
                            `${s.qField}: ${s.qSelected}`
                        ).join(', ');
                        addMessage('system', `Current selections: ${selectionText}`);
                    } else {
                        addMessage('system', 'No active selections.');
                    }
                });
            };

            // Initialize scope variables
            $scope.appName = 'Loading...';
        }],

        paint: function() {
            return qlik.Promise.resolve();
        }
    };
});
