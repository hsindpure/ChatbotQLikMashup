// qlik-ai-chatbot.js - Main Extension File
define([
    'jquery',
    'qlik',
    './properties',
    'text!./template.html',
    'text!./style.css'
], function($, qlik, props, template, cssContent) {
    'use strict';

    // Add CSS to head
    $('<style>').html(cssContent).appendTo('head');

    return {
        definition: props,
        template: template,
        support: {
            snapshot: false,
            export: false,
            exportData: false
        },
        
        paint: function($element, layout) {
            var app = qlik.currApp();
            var chatHistory = [];
            var currentUser = layout.qlik.user || 'User';
            var appName = '';
            var selectedRole = 'Analyst';
            var isRecording = false;
            var recognition = null;

            // Get app name
            app.getAppLayout().then(function(appLayout) {
                appName = appLayout.qTitle;
                $('#chatbot-header-title').text(appName);
            });

            // Initialize Speech Recognition
            if ('webkitSpeechRecognition' in window) {
                recognition = new webkitSpeechRecognition();
                recognition.continuous = false;
                recognition.interimResults = false;
                recognition.lang = 'en-US';
                
                recognition.onresult = function(event) {
                    var transcript = event.results[0][0].transcript;
                    $('#chat-input').val(transcript);
                    isRecording = false;
                    $('#voice-btn').removeClass('recording');
                };
                
                recognition.onerror = function(event) {
                    console.error('Speech recognition error:', event.error);
                    isRecording = false;
                    $('#voice-btn').removeClass('recording');
                };
            }

            // Chatbot functionality
            function initChatbot() {
                // Toggle chatbot
                $('#chatbot-toggle').click(function() {
                    $('#chatbot-container').toggleClass('active');
                });

                // Close chatbot
                $('#close-chatbot').click(function() {
                    $('#chatbot-container').removeClass('active');
                });

                // Role selection
                $('#role-select').change(function() {
                    selectedRole = $(this).val();
                    addMessage('system', `Role changed to ${selectedRole}`, 'System');
                });

                // Voice input
                $('#voice-btn').click(function() {
                    if (recognition && !isRecording) {
                        isRecording = true;
                        $(this).addClass('recording');
                        recognition.start();
                    }
                });

                // Send message
                $('#send-btn, #chat-input').on('click keypress', function(e) {
                    if (e.type === 'click' || e.which === 13) {
                        sendMessage();
                    }
                });

                // Download chat history
                $('#download-history').click(function() {
                    downloadChatHistory();
                });

                // Clear selections
                $('#clear-selections').click(function() {
                    app.clearAll();
                    addMessage('system', 'All selections cleared', 'System');
                });
            }

            function sendMessage() {
                var message = $('#chat-input').val().trim();
                if (!message) return;

                // Add user message
                addMessage('user', message, currentUser);
                $('#chat-input').val('');

                // Show typing indicator
                showTypingIndicator();

                // Process message
                processUserQuery(message);
            }

            function addMessage(type, message, sender) {
                var timestamp = new Date().toLocaleTimeString();
                var messageHtml = `
                    <div class="message ${type}">
                        <div class="message-header">
                            <span class="sender">${sender}</span>
                            <span class="timestamp">${timestamp}</span>
                        </div>
                        <div class="message-content">${message}</div>
                    </div>
                `;
                
                $('#chat-messages').append(messageHtml);
                $('#chat-messages').scrollTop($('#chat-messages')[0].scrollHeight);
                
                // Store in history
                chatHistory.push({
                    type: type,
                    message: message,
                    sender: sender,
                    timestamp: timestamp
                });
            }

            function showTypingIndicator() {
                var typingHtml = `
                    <div class="message bot typing-indicator">
                        <div class="message-header">
                            <span class="sender">AI Assistant</span>
                        </div>
                        <div class="message-content">
                            <div class="typing-dots">
                                <span></span>
                                <span></span>
                                <span></span>
                            </div>
                        </div>
                    </div>
                `;
                $('#chat-messages').append(typingHtml);
                $('#chat-messages').scrollTop($('#chat-messages')[0].scrollHeight);
            }

            function removeTypingIndicator() {
                $('.typing-indicator').remove();
            }

            async function processUserQuery(query) {
                try {
                    // Analyze query intent
                    var intent = analyzeIntent(query);
                    
                    // Get QlikSense data based on intent
                    var qlikData = await getQlikSenseData(intent);
                    
                    // Get AI response
                    var aiResponse = await getAIResponse(query, qlikData, selectedRole);
                    
                    removeTypingIndicator();
                    
                    // Display response
                    if (intent.requiresChart) {
                        displayChartResponse(aiResponse, qlikData);
                    } else {
                        addMessage('bot', aiResponse, 'AI Assistant');
                    }
                    
                } catch (error) {
                    removeTypingIndicator();
                    addMessage('bot', 'Sorry, I encountered an error processing your request.', 'AI Assistant');
                    console.error('Error processing query:', error);
                }
            }

            function analyzeIntent(query) {
                var intent = {
                    requiresChart: false,
                    requiresFilter: false,
                    requiresComparison: false,
                    chartType: null,
                    fields: []
                };

                // Simple intent analysis
                if (query.toLowerCase().includes('chart') || query.toLowerCase().includes('graph')) {
                    intent.requiresChart = true;
                    if (query.toLowerCase().includes('bar')) intent.chartType = 'bar';
                    else if (query.toLowerCase().includes('line')) intent.chartType = 'line';
                    else if (query.toLowerCase().includes('pie')) intent.chartType = 'pie';
                }

                if (query.toLowerCase().includes('filter') || query.toLowerCase().includes('select')) {
                    intent.requiresFilter = true;
                }

                if (query.toLowerCase().includes('compare') || query.toLowerCase().includes('benchmark')) {
                    intent.requiresComparison = true;
                }

                return intent;
            }

            async function getQlikSenseData(intent) {
                try {
                    // Get current selections
                    var currentSelections = await app.getList('CurrentSelections');
                    
                    // Get field list
                    var fieldList = await app.getList('FieldList');
                    
                    // Create a generic hypercube for data analysis
                    var hypercube = await app.createCube({
                        qDimensions: [
                            { qDef: { qFieldDefs: ['Month'] } },
                            { qDef: { qFieldDefs: ['Region'] } }
                        ],
                        qMeasures: [
                            { qDef: { qDef: 'Sum(Sales)', qLabel: 'Total Sales' } },
                            { qDef: { qDef: 'Count(Orders)', qLabel: 'Order Count' } }
                        ],
                        qInitialDataFetch: [{ qTop: 0, qLeft: 0, qHeight: 20, qWidth: 4 }]
                    });

                    var layout = await hypercube.getLayout();
                    
                    return {
                        selections: currentSelections,
                        fields: fieldList,
                        data: layout.qHyperCube.qDataPages[0].qMatrix,
                        dimensions: layout.qHyperCube.qDimensionInfo,
                        measures: layout.qHyperCube.qMeasureInfo
                    };
                    
                } catch (error) {
                    console.error('Error getting QlikSense data:', error);
                    return null;
                }
            }

            async function getAIResponse(query, qlikData, role) {
                // Simulate AI API call
                // In production, replace with actual AI API endpoint
                return new Promise((resolve) => {
                    setTimeout(() => {
                        var response = generateMockAIResponse(query, qlikData, role);
                        resolve(response);
                    }, 1500);
                });
            }

            function generateMockAIResponse(query, qlikData, role) {
                // Mock AI response based on role and data
                var responses = {
                    'Analyst': {
                        sales: 'Based on the current data, sales performance shows a positive trend. The key metrics indicate strong performance in Q3 with a 15% increase compared to market benchmarks.',
                        default: 'As an analyst, I can help you dive deep into the data patterns and provide statistical insights.'
                    },
                    'HR': {
                        employee: 'From an HR perspective, employee engagement metrics are crucial. Current data shows good retention rates compared to industry standards.',
                        default: 'As an HR professional, I focus on people analytics and workforce insights.'
                    },
                    'Manager': {
                        overview: 'From a management standpoint, the KPIs are meeting targets. Revenue growth is 8% above industry average.',
                        default: 'As a manager, I provide strategic insights and performance summaries.'
                    }
                };

                var roleResponses = responses[role] || responses['Analyst'];
                
                // Simple keyword matching for demo
                if (query.toLowerCase().includes('sales') || query.toLowerCase().includes('revenue')) {
                    return roleResponses.sales || roleResponses.default;
                } else if (query.toLowerCase().includes('employee') || query.toLowerCase().includes('hr')) {
                    return roleResponses.employee || roleResponses.default;
                } else {
                    return roleResponses.default + ' ' + generateDataInsight(qlikData);
                }
            }

            function generateDataInsight(qlikData) {
                if (!qlikData || !qlikData.data) return '';
                
                var totalSales = 0;
                var recordCount = qlikData.data.length;
                
                qlikData.data.forEach(row => {
                    if (row[2] && row[2].qNum) {
                        totalSales += row[2].qNum;
                    }
                });

                return `Current dataset contains ${recordCount} records with total sales of ${totalSales.toLocaleString()}.`;
            }

            function displayChartResponse(response, data) {
                var chartHtml = `
                    <div class="message bot">
                        <div class="message-header">
                            <span class="sender">AI Assistant</span>
                            <span class="timestamp">${new Date().toLocaleTimeString()}</span>
                        </div>
                        <div class="message-content">
                            ${response}
                            <div class="chart-container">
                                <canvas id="responseChart" width="300" height="200"></canvas>
                            </div>
                        </div>
                    </div>
                `;
                
                $('#chat-messages').append(chartHtml);
                $('#chat-messages').scrollTop($('#chat-messages')[0].scrollHeight);
                
                // Create simple chart (would use Chart.js in production)
                createSimpleChart(data);
            }

            function createSimpleChart(data) {
                // Simple chart creation using canvas
                var canvas = document.getElementById('responseChart');
                if (canvas) {
                    var ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#4CAF50';
                    ctx.fillRect(10, 10, 50, 100);
                    ctx.fillStyle = '#2196F3';
                    ctx.fillRect(70, 30, 50, 80);
                    ctx.fillStyle = '#FF9800';
                    ctx.fillRect(130, 50, 50, 60);
                    
                    ctx.fillStyle = '#333';
                    ctx.font = '12px Arial';
                    ctx.fillText('Sample Chart', 10, 130);
                }
            }

            function downloadChatHistory() {
                // Create PDF content
                var pdfContent = `
                    <h2>Chat History - ${appName}</h2>
                    <p>Generated on: ${new Date().toLocaleString()}</p>
                    <p>Role: ${selectedRole}</p>
                    <hr>
                `;
                
                chatHistory.forEach(chat => {
                    pdfContent += `
                        <div style="margin-bottom: 15px; padding: 10px; border-left: 3px solid ${chat.type === 'user' ? '#4CAF50' : '#2196F3'};">
                            <strong>${chat.sender}</strong> - ${chat.timestamp}<br>
                            ${chat.message}
                        </div>
                    `;
                });

                // Create and download PDF (simplified version)
                var printWindow = window.open('', '_blank');
                printWindow.document.write(`
                    <html>
                        <head><title>Chat History</title></head>
                        <body>${pdfContent}</body>
                    </html>
                `);
                printWindow.document.close();
                printWindow.print();
            }

            // Initialize chatbot
            initChatbot();
            
            // Add welcome message
            setTimeout(() => {
                addMessage('bot', `Welcome to ${appName || 'QlikSense'} AI Assistant! I can help you analyze data, create charts, and provide insights. What would you like to know?`, 'AI Assistant');
            }, 1000);

            return qlik.Promise.resolve();
        }
    };
});
