// State management
let tasks = {};
let archivedTasks = []; // Store archived tasks
let draggedTask = null;
let draggedTaskData = null;
let dragOffset = { x: 0, y: 0 };
let isArchiveOpen = false; // Track if archive is open

// Column Configuration - Single source of truth
// Add or modify columns here
const COLUMNS_CONFIG = [
    { id: 'todo', name: 'To Do' },
    { id: 'in-progress', name: 'In Progress' },
    { id: 'on-hold', name: 'On Hold' }
];

// Constants
const COLUMNS = COLUMNS_CONFIG.map(column => column.id);
const STORAGE_KEY = 'tasks';
const ARCHIVE_KEY = 'archivedTasks';
const COLUMNS_CONFIG_KEY = 'columnsConfig'; // New storage key for column configuration

/**
 * Initialize the application
 */
function initApp() {
    // Set up the UI elements first to ensure they're visible regardless of storage operations
    setupEventListeners();
    setupKanbanBoard();
    setupArchiveButton();
    
    // Then load data from storage and update the UI
    loadColumnsConfigFromStorage()
        .then(() => {
            // Rebuild UI with loaded config
            setupKanbanBoard();
            return loadTasksFromStorage();
        })
        .then(() => loadArchivedTasksFromStorage())
        .catch(error => {
            console.error('Error during data loading:', error);
            // Already have UI set up with default config
        });
}

/**
 * Load column configuration from Chrome storage
 * @returns {Promise} A promise that resolves when the column config is loaded
 */
function loadColumnsConfigFromStorage() {
    return new Promise((resolve, reject) => {
        try {
            chrome.storage.local.get([COLUMNS_CONFIG_KEY], (result) => {
                if (chrome.runtime.lastError) {
                    console.error('Chrome storage error:', chrome.runtime.lastError);
                    return resolve(); // Continue with defaults
                }
                
                try {
                    if (result[COLUMNS_CONFIG_KEY] && Array.isArray(result[COLUMNS_CONFIG_KEY]) && result[COLUMNS_CONFIG_KEY].length > 0) {
                        // Clear existing config
                        COLUMNS_CONFIG.length = 0;
                        
                        // Add configs from storage
                        result[COLUMNS_CONFIG_KEY].forEach(col => COLUMNS_CONFIG.push(col));
                        
                        // Update COLUMNS array to match
                        COLUMNS.length = 0;
                        COLUMNS_CONFIG.forEach(col => COLUMNS.push(col.id));
                        
                        // Rebuild kanban board with new config
                        setupKanbanBoard();
                    }
                    resolve();
                } catch (error) {
                    console.error('Error parsing column configuration:', error);
                    resolve(); // Continue with defaults
                }
            });
        } catch (error) {
            console.error('Unexpected error in loadColumnsConfigFromStorage:', error);
            resolve(); // Continue with defaults
        }
    });
}

/**
 * Save column configuration to Chrome storage
 */
function saveColumnsConfig() {
    chrome.storage.local.set({ [COLUMNS_CONFIG_KEY]: COLUMNS_CONFIG }, () => {
        if (chrome.runtime.lastError) {
            console.error('Error saving column configuration:', chrome.runtime.lastError);
        }
    });
}

/**
 * Load tasks from Chrome storage
 * @returns {Promise} A promise that resolves when tasks are loaded
 */
function loadTasksFromStorage() {
    return new Promise((resolve, reject) => {
        try {
            chrome.storage.local.get([STORAGE_KEY], (result) => {
                if (chrome.runtime.lastError) {
                    console.error('Chrome storage error:', chrome.runtime.lastError);
                    return resolve(); // Continue with defaults
                }
                
                try {
                    // Initialize with empty arrays for all configured columns
                    const defaultTasks = {};
                    COLUMNS.forEach(columnId => {
                        defaultTasks[columnId] = [];
                    });
                    
                    tasks = result[STORAGE_KEY] || defaultTasks;
                    
                    // Add any missing columns from config
                    COLUMNS.forEach(columnId => {
                        if (!tasks[columnId]) {
                            tasks[columnId] = [];
                        }
                    });
                    
                    renderTasks();
                    resolve();
                } catch (error) {
                    console.error('Error parsing tasks:', error);
                    // Initialize with empty state if there's an error
                    const defaultTasks = {};
                    COLUMNS.forEach(columnId => {
                        defaultTasks[columnId] = [];
                    });
                    tasks = defaultTasks;
                    renderTasks();
                    resolve(); // Continue despite error
                }
            });
        } catch (error) {
            console.error('Unexpected error in loadTasksFromStorage:', error);
            const defaultTasks = {};
            COLUMNS.forEach(columnId => {
                defaultTasks[columnId] = [];
            });
            tasks = defaultTasks;
            renderTasks();
            resolve(); // Continue despite error
        }
    });
}

/**
 * Load archived tasks from Chrome storage
 * @returns {Promise} A promise that resolves when archived tasks are loaded
 */
function loadArchivedTasksFromStorage() {
    return new Promise((resolve, reject) => {
        try {
            chrome.storage.local.get([ARCHIVE_KEY], (result) => {
                if (chrome.runtime.lastError) {
                    console.error('Chrome storage error:', chrome.runtime.lastError);
                    archivedTasks = [];
                    return resolve(); // Continue with defaults
                }
                
                try {
                    archivedTasks = result[ARCHIVE_KEY] || [];
                    resolve();
                } catch (error) {
                    console.error('Error parsing archived tasks:', error);
                    archivedTasks = [];
                    resolve(); // Continue despite error
                }
            });
        } catch (error) {
            console.error('Unexpected error in loadArchivedTasksFromStorage:', error);
            archivedTasks = [];
            resolve(); // Continue despite error
        }
    });
}

/**
 * Save archived tasks to Chrome storage
 */
function saveArchivedTasks() {
    chrome.storage.local.set({ [ARCHIVE_KEY]: archivedTasks }, () => {
        if (chrome.runtime.lastError) {
            console.error('Error saving archived tasks:', chrome.runtime.lastError);
        }
    });
}

/**
 * Setup buttons (archive and settings)
 */
function setupArchiveButton() {
    // Create a container for the buttons
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'button-container';
    
    // Get the existing add task button
    const addTaskButton = document.getElementById('add-task');
    
    // Create archive button (on left)
    const archiveButton = document.createElement('button');
    archiveButton.id = 'archive-button';
    archiveButton.className = 'archive-button';
    archiveButton.setAttribute('aria-label', 'View Archive');
    archiveButton.setAttribute('title', 'View Archive');
    archiveButton.innerHTML = '📦';
    
    // Create settings button (on right)
    const settingsButton = document.createElement('button');
    settingsButton.id = 'settings-button';
    settingsButton.className = 'settings-button';
    settingsButton.setAttribute('aria-label', 'Board Settings');
    settingsButton.setAttribute('title', 'Board Settings');
    settingsButton.innerHTML = '⚙️';
    
    // Replace the add task button with the container
    const parent = addTaskButton.parentNode;
    parent.replaceChild(buttonContainer, addTaskButton);
    
    // Add buttons to the container in the desired order
    buttonContainer.appendChild(archiveButton);
    buttonContainer.appendChild(addTaskButton);
    buttonContainer.appendChild(settingsButton);
    
    // Add event listeners
    archiveButton.addEventListener('click', toggleArchiveView);
    settingsButton.addEventListener('click', openKanbanSettings);
}

/**
 * Toggle archive view
 */
function toggleArchiveView() {
    isArchiveOpen = !isArchiveOpen;
    
    // Remove existing archive container
    const existingArchive = document.getElementById('archive-container');
    if (existingArchive) {
        existingArchive.remove();
    }
    
    if (isArchiveOpen) {
        // If opening the archive
        document.getElementById('archive-button').innerHTML = '⬅️';
        document.getElementById('archive-button').setAttribute('title', 'Back to Tasks');
        
        // Hide main view elements
        document.querySelector('.kanban-board').style.display = 'none';
        document.getElementById('add-task').style.display = 'none';
        document.getElementById('settings-button').style.display = 'none';
        
        // Create the archive view
        createArchiveView();
    } else {
        // If closing the archive, show main view
        document.getElementById('archive-button').innerHTML = '📦';
        document.getElementById('archive-button').setAttribute('title', 'View Archive');
        
        // Show main view elements
        document.querySelector('.kanban-board').style.display = '';
        document.getElementById('add-task').style.display = '';
        document.getElementById('settings-button').style.display = '';
        
        // Render tasks in main view
        renderTasks();
    }
}

/**
 * Create and show archive view
 */
function createArchiveView() {
    const archiveContainer = document.createElement('div');
    archiveContainer.id = 'archive-container';
    
    // Header with task count
    const headerContainer = document.createElement('div');
    headerContainer.className = 'archive-header-container';
    
    const header = document.createElement('h2');
    header.textContent = 'Archived Tasks';
    headerContainer.appendChild(header);
    
    // Add task count
    if (archivedTasks.length > 0) {
        const countBadge = document.createElement('span');
        countBadge.className = 'archive-count-badge';
        countBadge.textContent = archivedTasks.length;
        headerContainer.appendChild(countBadge);
        
        // Add clear all button
        const clearAllButton = document.createElement('button');
        clearAllButton.className = 'clear-all-button';
        clearAllButton.textContent = 'Clear All';
        clearAllButton.addEventListener('click', () => {
            showConfirmationModal(
                'Are you sure you want to permanently delete ALL archived tasks? This cannot be undone.',
                () => {
                    archivedTasks = [];
                    saveArchivedTasks();
                    handleArchiveViewUpdate();
                },
                'Delete All',
                'Cancel',
                true // Mark as dangerous action
            );
        });
        headerContainer.appendChild(clearAllButton);
    }
    
    archiveContainer.appendChild(headerContainer);
    
    if (archivedTasks.length === 0) {
        // No archived tasks
        const emptyMessage = document.createElement('p');
        emptyMessage.className = 'empty-archive-message';
        emptyMessage.textContent = 'No archived tasks yet.';
        archiveContainer.appendChild(emptyMessage);
    } else {
        // Create list of archived tasks
        const tasksList = document.createElement('div');
        tasksList.className = 'archived-tasks';
        
        archivedTasks.forEach((archivedTask, index) => {
            const taskElement = document.createElement('div');
            taskElement.className = 'archived-task';
            
            // Archive date (if available)
            if (archivedTask.archivedAt) {
                const dateElement = document.createElement('span');
                dateElement.className = 'archive-date';
                dateElement.textContent = new Date(archivedTask.archivedAt).toLocaleString();
                taskElement.appendChild(dateElement);
            }
            
            // Task text
            const taskText = document.createElement('p');
            taskText.textContent = archivedTask.text;
            taskElement.appendChild(taskText);
            
            // Original column badge
            const columnBadge = document.createElement('span');
            columnBadge.className = 'column-badge';
            
            // Find the column name from its ID
            const columnConfig = COLUMNS_CONFIG.find(col => col.id === archivedTask.column);
            columnBadge.textContent = columnConfig ? columnConfig.name : archivedTask.column;
            taskElement.appendChild(columnBadge);
            
            // Button container
            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'archive-button-container';
            
            // Restore button
            const restoreButton = document.createElement('button');
            restoreButton.className = 'restore-button';
            restoreButton.innerHTML = '↩️ Restore';
            restoreButton.addEventListener('click', () => restoreTask(index));
            buttonContainer.appendChild(restoreButton);
            
            // Permanently delete button
            const deleteButton = document.createElement('button');
            deleteButton.className = 'delete-permanently-button';
            deleteButton.innerHTML = '🗑️ Delete Permanently';
            deleteButton.addEventListener('click', () => deleteTaskPermanently(index));
            buttonContainer.appendChild(deleteButton);
            
            taskElement.appendChild(buttonContainer);
            tasksList.appendChild(taskElement);
        });
        
        archiveContainer.appendChild(tasksList);
    }
    
    // Insert the archive container into the DOM
    document.querySelector('main').appendChild(archiveContainer);
}

/**
 * Restore a task from the archive
 * @param {number} index - Index of task in archive array
 */
function restoreTask(index) {
    if (index < 0 || index >= archivedTasks.length) return;
    
    const taskToRestore = archivedTasks[index];
    
    // Check if the original column still exists
    let targetColumn = taskToRestore.column;
    if (!COLUMNS.includes(targetColumn)) {
        // If not, set it to the first column
        targetColumn = COLUMNS_CONFIG[0].id;
    }
    
    // Create a clean task object with ONLY the required properties
    const restoredTask = {
        // Use original ID if available, otherwise create a new one
        id: taskToRestore.id || Date.now(),
        text: taskToRestore.text,
        column: targetColumn
    };
    
    // Add to target column
    tasks[targetColumn].push(restoredTask);
    
    // Remove from archive
    archivedTasks.splice(index, 1);
    
    // Save changes
    saveTasks();
    saveArchivedTasks();
    
    // Update UI based on archive state
    handleArchiveViewUpdate();
}

/**
 * Update the UI after archive changes
 * Helper function to handle common view toggle logic
 */
function handleArchiveViewUpdate() {
    // Remove archive container completely regardless of archive state
    const existingArchive = document.getElementById('archive-container');
    if (existingArchive) {
        existingArchive.remove();
    }
    
    if (archivedTasks.length === 0) {
        // If archive is now empty, return to main view
        isArchiveOpen = false;
        
        // Show main view elements
        document.querySelector('.kanban-board').style.display = '';
        document.getElementById('add-task').style.display = '';
        document.getElementById('settings-button').style.display = '';
        
        // Reset archive button
        document.getElementById('archive-button').innerHTML = '📦';
        document.getElementById('archive-button').setAttribute('title', 'View Archive');
        
        // Render tasks in main view
        renderTasks();
    } else {
        // If there are still items in archive, refresh the archive view
        createArchiveView();
    }
}

/**
 * Permanently delete a task from the archive
 * @param {number} index - Index of task in archive array
 */
function deleteTaskPermanently(index) {
    if (index < 0 || index >= archivedTasks.length) return;
    
    showConfirmationModal(
        'Are you sure you want to permanently delete this task?',
        () => {
            // Remove from archive
            archivedTasks.splice(index, 1);
            
            // Save changes
            saveArchivedTasks();
            
            // Update UI based on archive state
            handleArchiveViewUpdate();
        },
        'Delete', 
        'Cancel',
        true // Mark as dangerous action
    );
}

/**
 * Create and append the kanban board boards (sections) dynamically based on configuration
 */
function setupKanbanBoard() {
    const kanbanBoard = document.querySelector('.kanban-board');
    
    // Clear existing boards if any
    kanbanBoard.innerHTML = '';
    
    // Create boards based on configuration
    COLUMNS_CONFIG.forEach(column => {
        const boardElement = document.createElement('section');
        boardElement.classList.add('board');
        boardElement.id = column.id;
        boardElement.setAttribute('aria-label', `${column.name} Board`);
        
        const heading = document.createElement('h2');
        heading.textContent = column.name;
        
        const tasksContainer = document.createElement('div');
        tasksContainer.classList.add('tasks');
        tasksContainer.setAttribute('role', 'list');
        tasksContainer.setAttribute('aria-label', `${column.name} Tasks`);
        
        boardElement.appendChild(heading);
        boardElement.appendChild(tasksContainer);
        kanbanBoard.appendChild(boardElement);
    });
}

/**
 * Setup all event listeners
 */
function setupEventListeners() {
    // Add task button
    document.getElementById('add-task').addEventListener('click', handleAddTask);
    
    // Drag and drop events
    document.addEventListener('dragstart', handleDragStart);
    document.addEventListener('drag', handleDrag);
    document.addEventListener('dragend', handleDragEnd);
}

/**
 * Handle adding a new task
 */
function handleAddTask() {
    const taskId = Date.now();
    const taskEl = createEditableTask(taskId);
    
    // Use the first column from configuration
    const firstColumnId = COLUMNS_CONFIG[0].id;
    const firstColumnTasksDiv = document.querySelector(`#${firstColumnId} .tasks`);
    
    if (firstColumnTasksDiv) {
        firstColumnTasksDiv.insertBefore(taskEl, firstColumnTasksDiv.firstChild);
        
        const input = taskEl.querySelector('.task-input');
        input.focus();
    } else {
        console.error(`First column tasks container (#${firstColumnId} .tasks) not found`);
    }
}

/**
 * Create an editable task element
 * @param {number} id - Task ID
 * @returns {HTMLElement} Task element
 */
function createEditableTask(id) {
    const taskEl = document.createElement('div');
    taskEl.classList.add('task', 'editing');
    taskEl.draggable = false;
    taskEl.dataset.id = id;

    const input = document.createElement('input');
    input.type = 'text';
    input.classList.add('task-input');
    input.placeholder = 'Enter task description';

    input.addEventListener('blur', () => {
        if (input.value.trim()) {
            // Use the first column from configuration
            const firstColumnId = COLUMNS_CONFIG[0].id;
            
            const task = {
                id: id,
                text: input.value.trim(),
                column: firstColumnId
            };
            tasks[firstColumnId].push(task);
            saveTasks();
            renderTasks();
        } else {
            taskEl.remove();
        }
    });

    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            input.blur();
        }
    });

    taskEl.appendChild(input);
    return taskEl;
}

/**
 * Render all tasks across columns
 */
function renderTasks() {
    COLUMNS.forEach(column => {
        const tasksDiv = document.querySelector(`#${column} .tasks`);
        tasksDiv.innerHTML = '';
        
        if (!tasks[column] || !Array.isArray(tasks[column])) {
            console.error(`Invalid tasks for column: ${column}`);
            return;
        }
        
        tasks[column].forEach(task => {
            const taskEl = document.createElement('div');
            taskEl.classList.add('task');
            taskEl.draggable = true;
            taskEl.dataset.id = task.id;
            
            const deleteBtn = document.createElement('button');
            deleteBtn.classList.add('delete-task');
            deleteBtn.innerHTML = '&times;';
            deleteBtn.addEventListener('click', () => deleteTask(task.id, column));
            deleteBtn.setAttribute('aria-label', 'Delete task');
            
            const textContent = document.createElement('p');
            textContent.textContent = task.text;
            textContent.classList.add('task-content');
            
            taskEl.appendChild(deleteBtn);
            taskEl.appendChild(textContent);
            
            // Add double click handler for editing
            taskEl.addEventListener('dblclick', (e) => {
                if (!taskEl.classList.contains('editing')) {
                    makeTaskEditable(taskEl, task);
                }
                e.stopPropagation();
            });
            
            tasksDiv.appendChild(taskEl);
        });
    });
}

/**
 * Make a task editable
 * @param {HTMLElement} taskEl - Task element
 * @param {Object} task - Task data
 */
function makeTaskEditable(taskEl, task) {
    taskEl.draggable = false;
    taskEl.classList.add('editing');
    
    // Save original content to restore if needed
    const originalContent = task.text;
    
    const input = document.createElement('input');
    input.type = 'text';
    input.classList.add('task-input');
    input.value = task.text;
    
    // Clear the task element
    taskEl.textContent = '';
    taskEl.appendChild(input);
    input.focus();
    input.select(); // Select all text for easy editing

    // Handle finishing edit on blur
    input.addEventListener('blur', () => {
        finishEditing(taskEl, task, input.value.trim(), originalContent);
    });

    // Handle enter key press
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            input.blur();
        } else if (e.key === 'Escape') {
            // Restore original text on escape
            input.value = originalContent;
            input.blur();
        }
    });
}

/**
 * Finish editing a task
 * @param {HTMLElement} taskEl - Task element
 * @param {Object} task - Task data
 * @param {string} newText - New task text
 * @param {string} originalText - Original task text
 */
function finishEditing(taskEl, task, newText, originalText) {
    if (newText && newText !== task.text) {
        task.text = newText;
        saveTasks();
    } else if (!newText) {
        // If empty, restore original text
        task.text = originalText;
    }
    renderTasks();
}

/**
 * Save tasks to Chrome storage
 */
function saveTasks() {
    chrome.storage.local.set({ [STORAGE_KEY]: tasks }, () => {
        if (chrome.runtime.lastError) {
            console.error('Error saving tasks:', chrome.runtime.lastError);
        }
    });
}

/**
 * Handle drag start event
 * @param {DragEvent} e - Drag event
 */
function handleDragStart(e) {
    if (!e.target.classList.contains('task')) return;
    
    draggedTask = e.target;
    const taskId = parseInt(draggedTask.dataset.id);
    const columnId = draggedTask.closest('.board').id;
    
    // Store task data before modifying the DOM
    draggedTaskData = {
        id: taskId,
        column: columnId,
        task: tasks[columnId].find(t => t.id === taskId)
    };
    
    if (!draggedTaskData.task) {
        console.error('Task not found:', taskId, columnId);
        return;
    }
    
    const rect = draggedTask.getBoundingClientRect();
    const tasksRect = draggedTask.closest('.tasks').getBoundingClientRect();
    
    dragOffset = {
        y: e.clientY - rect.top,
        x: tasksRect.left
    };
    
    // Create invisible drag image
    const ghost = document.createElement('div');
    ghost.style.display = 'none';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    
    // Remove ghost element after drag starts
    setTimeout(() => {
        document.body.removeChild(ghost);
    }, 0);
    
    requestAnimationFrame(() => {
        draggedTask.classList.add('dragging');
        updateDragPosition(e.clientX, e.clientY);
    });
}

/**
 * Handle drag event
 * @param {DragEvent} e - Drag event
 */
function handleDrag(e) {
    if (!draggedTask || !e.clientX || !e.clientY) return;
    
    updateDragPosition(e.clientX, e.clientY);
    
    // Remove highlight from all boards and tasks containers
    document.querySelectorAll('.board, .tasks').forEach(el => {
        el.classList.remove('drag-over');
    });
    
    // Find target tasks container and highlight
    const targetTasks = document.elementFromPoint(e.clientX, e.clientY)?.closest('.tasks');
    if (targetTasks) {
        targetTasks.classList.add('drag-over');
        targetTasks.closest('.board').classList.add('drag-over');
        handleColumnDrag(targetTasks, e.clientY);
    }
}

/**
 * Update position of dragged task
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 */
function updateDragPosition(x, y) {
    if (!draggedTask) return;
    draggedTask.style.left = `${dragOffset.x}px`;
    draggedTask.style.top = `${y - dragOffset.y}px`;
}

/**
 * Handle dragging within a column
 * @param {HTMLElement} column - Column element
 * @param {number} clientY - Y coordinate
 */
function handleColumnDrag(column, clientY) {
    const columnTasks = Array.from(column.children).filter(
        el => el.classList.contains('task') && !el.classList.contains('dragging')
    );
    
    if (columnTasks.length === 0) {
        // Empty column, no need to calculate positions
        return;
    }
    
    columnTasks.forEach(task => {
        const rect = task.getBoundingClientRect();
        const middle = rect.top + rect.height / 2;
        task.classList.remove('shift-up', 'shift-down');
        
        if (clientY < middle) {
            task.classList.add('shift-down');
        } else if (clientY > middle) {
            const nextTask = task.nextElementSibling;
            if (!nextTask || !nextTask.classList.contains('task')) {
                task.classList.add('shift-up');
            }
        }
    });
}

/**
 * Handle drag end event
 * @param {DragEvent} e - Drag event
 */
function handleDragEnd(e) {
    if (!draggedTask || !draggedTaskData) return;
    
    // Reset position styles immediately
    draggedTask.style.left = '';
    draggedTask.style.top = '';
    draggedTask.classList.remove('dragging');
    
    // Find target tasks container
    const targetTasks = document.elementFromPoint(e.clientX, e.clientY)?.closest('.tasks');
    if (targetTasks) {
        const targetColumn = targetTasks.closest('.board');
        const columnTasks = Array.from(targetTasks.children)
            .filter(el => el.classList.contains('task'));
        
        let dropIndex = columnTasks.length;
        
        // Only calculate position if there are existing tasks
        if (columnTasks.length > 0) {
            for (let i = 0; i < columnTasks.length; i++) {
                const taskRect = columnTasks[i].getBoundingClientRect();
                const middle = taskRect.top + taskRect.height / 2;
                
                if (e.clientY <= middle) {
                    dropIndex = i;
                    break;
                }
            }
        }
        
        // Update data structure
        const sourceColumnTasks = tasks[draggedTaskData.column];
        const targetColumnTasks = tasks[targetColumn.id];
        
        // Remove from source
        const taskIndex = sourceColumnTasks.findIndex(t => t.id === draggedTaskData.task.id);
        if (taskIndex !== -1) {
            sourceColumnTasks.splice(taskIndex, 1);
        }
        
        // Add to target
        const updatedTask = { ...draggedTaskData.task, column: targetColumn.id };
        targetColumnTasks.splice(dropIndex, 0, updatedTask);
        
        saveTasks();
        renderTasks();
    }
    
    // Clean up
    cleanupDragState();
}

/**
 * Clean up drag state
 */
function cleanupDragState() {
    // Remove classes
    document.querySelectorAll('.board, .tasks').forEach(el => {
        el.classList.remove('drag-over');
    });
    
    document.querySelectorAll('.task').forEach(task => {
        task.classList.remove('shift-up', 'shift-down');
    });
    
    // Reset drag state
    draggedTask = null;
    draggedTaskData = null;
}

/**
 * Delete a task (now moves to archive instead)
 * @param {number} taskId - Task ID
 * @param {string} column - Column ID
 */
function deleteTask(taskId, column) {
    if (!tasks[column]) {
        console.error(`Column not found: ${column}`);
        return;
    }
    
    // Find the task
    const taskIndex = tasks[column].findIndex(task => task.id === taskId);
    
    if (taskIndex !== -1) {
        const taskToArchive = tasks[column][taskIndex];
        
        // Add to archive with timestamp and preserve the original ID
        archivedTasks.push({
            id: taskToArchive.id,  // Preserve the original ID
            text: taskToArchive.text,
            column: column,
            archivedAt: Date.now()
        });
        
        // Remove from active tasks
        tasks[column].splice(taskIndex, 1);
        
        // Save both active tasks and archive
        saveTasks();
        saveArchivedTasks();
        
        // Refresh the UI
        renderTasks();
    }
}

/**
 * Open kanban settings popup
 */
function openKanbanSettings() {
    // Hide any existing settings modal
    const existingModal = document.getElementById('settings-modal');
    if (existingModal) {
        existingModal.remove();
    }
    
    // Create settings modal
    const modal = document.createElement('div');
    modal.id = 'settings-modal';
    modal.className = 'settings-modal';
    
    // Modal header
    const header = document.createElement('div');
    header.className = 'settings-header';
    
    const title = document.createElement('h2');
    title.textContent = 'Board Settings';
    
    const closeButton = document.createElement('button');
    closeButton.className = 'close-button';
    closeButton.innerHTML = '×';
    closeButton.setAttribute('title', 'Close');
    closeButton.addEventListener('click', () => modal.remove());
    
    header.appendChild(title);
    header.appendChild(closeButton);
    modal.appendChild(header);
    
    // Column list
    const columnList = document.createElement('div');
    columnList.className = 'column-list';
    
    // Variables for drag and drop
    let draggedColumnItem = null;
    
    // Create entries for each existing column
    COLUMNS_CONFIG.forEach((column, index) => {
        const columnItem = document.createElement('div');
        columnItem.className = 'column-item';
        columnItem.draggable = true;
        columnItem.dataset.id = column.id;
        columnItem.dataset.index = index;
        
        // Drag handle
        const dragHandle = document.createElement('div');
        dragHandle.className = 'drag-handle';
        dragHandle.innerHTML = '⠿';
        dragHandle.setAttribute('title', 'Drag to reorder');
        
        // Column input (for name)
        const columnInput = document.createElement('input');
        columnInput.type = 'text';
        columnInput.className = 'column-name-input';
        columnInput.value = column.name;
        columnInput.dataset.id = column.id;
        
        // Remove column button
        const removeButton = document.createElement('button');
        removeButton.className = 'remove-column-button';
        removeButton.innerHTML = '🗑️';
        removeButton.setAttribute('title', 'Remove Column');
        
        // Disable removing if it's the last column
        if (COLUMNS_CONFIG.length <= 1) {
            removeButton.disabled = true;
            removeButton.setAttribute('title', 'Cannot remove the last column');
        }
        
        removeButton.addEventListener('click', () => {
            if (COLUMNS_CONFIG.length > 1) {
                // Apply inline styles for animation instead of using the 'removing' class
                columnItem.style.transition = 'opacity 0.3s, transform 0.3s';
                columnItem.style.opacity = '0';
                columnItem.style.transform = 'scale(0.9)';
                columnItem.style.overflow = 'hidden';
                columnItem.style.maxHeight = columnItem.offsetHeight + 'px';
                
                setTimeout(() => {
                    // Animate height collapse
                    columnItem.style.maxHeight = '0';
                    columnItem.style.marginTop = '0';
                    columnItem.style.marginBottom = '0';
                    columnItem.style.paddingTop = '0';
                    columnItem.style.paddingBottom = '0';
                    
                    setTimeout(() => {
                        columnItem.remove();
                    }, 150);
                }, 150);
            }
        });
        
        // Add all elements to the column item
        columnItem.appendChild(dragHandle);
        columnItem.appendChild(columnInput);
        columnItem.appendChild(removeButton);
        
        // Set up drag events
        columnItem.addEventListener('dragstart', (e) => {
            draggedColumnItem = columnItem;
            columnItem.classList.add('dragging-column');
            
            // Create a semi-transparent drag image
            const rect = columnItem.getBoundingClientRect();
            const ghostEl = columnItem.cloneNode(true);
            ghostEl.style.width = rect.width + 'px';
            ghostEl.style.opacity = '0.6';
            ghostEl.style.position = 'absolute';
            ghostEl.style.top = '-1000px';
            document.body.appendChild(ghostEl);
            
            e.dataTransfer.setDragImage(ghostEl, 10, 10);
            
            // Remove ghost element after a moment
            setTimeout(() => {
                document.body.removeChild(ghostEl);
            }, 0);
        });
        
        columnItem.addEventListener('dragend', () => {
            draggedColumnItem.classList.remove('dragging-column');
            draggedColumnItem = null;
            
            // Remove all placeholder styles
            columnList.querySelectorAll('.column-item').forEach(item => {
                item.classList.remove('drag-above', 'drag-below');
            });
        });
        
        columnList.appendChild(columnItem);
    });
    
    // Add dragover and drop event listeners to column list
    columnList.addEventListener('dragover', (e) => {
        e.preventDefault();
        
        if (!draggedColumnItem) return;
        
        const itemUnderCursor = getItemUnderCursor(e.clientY);
        
        if (!itemUnderCursor) return;
        
        // Clear previous placeholder styles
        columnList.querySelectorAll('.column-item').forEach(item => {
            if (item !== draggedColumnItem) {
                item.classList.remove('drag-above', 'drag-below');
            }
        });
        
        // Skip if hovering over the dragged item
        if (itemUnderCursor === draggedColumnItem) return;
        
        const draggedIndex = Array.from(columnList.children).indexOf(draggedColumnItem);
        const targetIndex = Array.from(columnList.children).indexOf(itemUnderCursor);
        
        if (draggedIndex < targetIndex) {
            itemUnderCursor.classList.add('drag-below');
        } else {
            itemUnderCursor.classList.add('drag-above');
        }
    });
    
    columnList.addEventListener('drop', (e) => {
        e.preventDefault();
        
        if (!draggedColumnItem) return;
        
        const itemUnderCursor = getItemUnderCursor(e.clientY);
        
        if (!itemUnderCursor || itemUnderCursor === draggedColumnItem) return;
        
        // Get the position to insert the dragged item
        const draggedIndex = Array.from(columnList.children).indexOf(draggedColumnItem);
        const targetIndex = Array.from(columnList.children).indexOf(itemUnderCursor);
        
        // Insert at appropriate position
        if (draggedIndex < targetIndex) {
            // Insert after target
            columnList.insertBefore(draggedColumnItem, itemUnderCursor.nextSibling);
        } else {
            // Insert before target
            columnList.insertBefore(draggedColumnItem, itemUnderCursor);
        }
        
        // Remove placeholder styles
        columnList.querySelectorAll('.column-item').forEach(item => {
            item.classList.remove('drag-above', 'drag-below');
        });
    });
    
    // Function to get item under cursor
    function getItemUnderCursor(clientY) {
        // Filter items that are not being dragged and not being removed (opacity > 0)
        const columnItems = Array.from(columnList.querySelectorAll('.column-item:not(.dragging-column)'))
            .filter(item => item.style.opacity !== '0');
        
        for (const item of columnItems) {
            const rect = item.getBoundingClientRect();
            if (clientY >= rect.top && clientY <= rect.bottom) {
                return item;
            }
        }
        
        return null;
    }
    
    // Add new column button
    const addColumnButton = document.createElement('button');
    addColumnButton.className = 'add-column-button';
    addColumnButton.innerHTML = '+ Add New Column';
    addColumnButton.addEventListener('click', () => {
        // Generate a unique ID for the new column
        const newId = 'column-' + Date.now();
        
        // Create new column item
        const columnItem = document.createElement('div');
        columnItem.className = 'column-item new-column';
        columnItem.draggable = true;
        columnItem.dataset.id = newId;
        
        // Drag handle
        const dragHandle = document.createElement('div');
        dragHandle.className = 'drag-handle';
        dragHandle.innerHTML = '⠿';
        dragHandle.setAttribute('title', 'Drag to reorder');
        
        // Column input
        const columnInput = document.createElement('input');
        columnInput.type = 'text';
        columnInput.className = 'column-name-input';
        columnInput.value = 'New Column';
        columnInput.dataset.id = newId;
        columnInput.select();
        
        // Remove button
        const removeButton = document.createElement('button');
        removeButton.className = 'remove-column-button';
        removeButton.innerHTML = '🗑️';
        removeButton.setAttribute('title', 'Remove Column');
        removeButton.addEventListener('click', () => {
            // Apply inline styles for animation instead of using the 'removing' class
            columnItem.style.transition = 'opacity 0.3s, transform 0.3s';
            columnItem.style.opacity = '0';
            columnItem.style.transform = 'scale(0.9)';
            columnItem.style.overflow = 'hidden';
            columnItem.style.maxHeight = columnItem.offsetHeight + 'px';
            
            setTimeout(() => {
                // Animate height collapse
                columnItem.style.maxHeight = '0';
                columnItem.style.marginTop = '0';
                columnItem.style.marginBottom = '0';
                columnItem.style.paddingTop = '0';
                columnItem.style.paddingBottom = '0';
                
                setTimeout(() => {
                    columnItem.remove();
                }, 150);
            }, 150);
        });
        
        // Add all elements to column item
        columnItem.appendChild(dragHandle);
        columnItem.appendChild(columnInput);
        columnItem.appendChild(removeButton);
        
        // Set up drag events
        columnItem.addEventListener('dragstart', (e) => {
            draggedColumnItem = columnItem;
            columnItem.classList.add('dragging-column');
            
            // Create a semi-transparent drag image
            const rect = columnItem.getBoundingClientRect();
            const ghostEl = columnItem.cloneNode(true);
            ghostEl.style.width = rect.width + 'px';
            ghostEl.style.opacity = '0.6';
            ghostEl.style.position = 'absolute';
            ghostEl.style.top = '-1000px';
            document.body.appendChild(ghostEl);
            
            e.dataTransfer.setDragImage(ghostEl, 10, 10);
            
            // Remove ghost element after a moment
            setTimeout(() => {
                document.body.removeChild(ghostEl);
            }, 0);
        });
        
        columnItem.addEventListener('dragend', () => {
            draggedColumnItem.classList.remove('dragging-column');
            draggedColumnItem = null;
            
            // Remove all placeholder styles
            columnList.querySelectorAll('.column-item').forEach(item => {
                item.classList.remove('drag-above', 'drag-below');
            });
        });
        
        columnList.appendChild(columnItem);
        
        // Focus on new input
        columnInput.focus();
        columnInput.select();
    });
    
    modal.appendChild(columnList);
    modal.appendChild(addColumnButton);
    
    // Save button
    const saveButton = document.createElement('button');
    saveButton.className = 'save-settings-button';
    saveButton.textContent = 'Save Changes';
    saveButton.addEventListener('click', () => {
        // Get all column items that aren't being removed (opacity > 0)
        const columnItems = Array.from(columnList.querySelectorAll('.column-item'))
            .filter(item => item.style.opacity !== '0');
        
        // Create new column config
        const newColumnsConfig = [];
        let hasEmptyName = false;
        
        columnItems.forEach(item => {
            const input = item.querySelector('.column-name-input');
            const name = input.value.trim();
            const id = input.dataset.id;
            
            if (!name) {
                hasEmptyName = true;
                input.classList.add('error');
                return;
            }
            
            newColumnsConfig.push({
                id: id,
                name: name
            });
        });
        
        // Validate we have at least one column
        if (newColumnsConfig.length === 0) {
            alert('You must have at least one column.');
            return;
        }
        
        // Check for empty names
        if (hasEmptyName) {
            alert('Column names cannot be empty.');
            return;
        }
        
        // Save new configuration
        updateColumnsConfiguration(newColumnsConfig);
        
        // Close modal
        modal.remove();
    });
    
    modal.appendChild(saveButton);
    
    // Add modal to the DOM
    document.querySelector('main').appendChild(modal);
}

/**
 * Update the columns configuration
 * @param {Array} newConfig - New column configuration
 */
function updateColumnsConfiguration(newConfig) {
    // Update COLUMNS_CONFIG with new values
    COLUMNS_CONFIG.length = 0;
    newConfig.forEach(col => COLUMNS_CONFIG.push(col));
    
    // Update derived COLUMNS array
    const newColumns = COLUMNS_CONFIG.map(column => column.id);
    COLUMNS.length = 0;
    newColumns.forEach(col => COLUMNS.push(col));
    
    // Handle removed columns - move tasks to the first available column
    const firstColumnId = COLUMNS_CONFIG[0].id;
    
    // Get all keys from tasks object
    const existingColumns = Object.keys(tasks);
    
    // Find columns that no longer exist
    existingColumns.forEach(columnId => {
        if (!COLUMNS.includes(columnId) && tasks[columnId] && tasks[columnId].length > 0) {
            // Move tasks to the first column
            if (!tasks[firstColumnId]) {
                tasks[firstColumnId] = [];
            }
            
            tasks[columnId].forEach(task => {
                tasks[firstColumnId].push({
                    ...task,
                    column: firstColumnId
                });
            });
            
            // Remove the old column
            delete tasks[columnId];
        }
    });
    
    // Initialize new columns
    COLUMNS.forEach(columnId => {
        if (!tasks[columnId]) {
            tasks[columnId] = [];
        }
    });
    
    // Save tasks
    saveTasks();
    
    // Save column configuration
    saveColumnsConfig();
    
    // Rebuild the board
    setupKanbanBoard();
    renderTasks();
}

/**
 * Show a custom confirmation modal
 * @param {string} message - The message to display
 * @param {Function} onConfirm - Callback function to execute if confirmed
 * @param {string} [confirmText="Confirm"] - Text for the confirm button
 * @param {string} [cancelText="Cancel"] - Text for the cancel button
 * @param {boolean} [isDangerousAction=false] - Whether this is a dangerous action (will style button red)
 */
function showConfirmationModal(message, onConfirm, confirmText = "Confirm", cancelText = "Cancel", isDangerousAction = false) {
    // Remove any existing confirmation modal
    const existingModal = document.getElementById('confirmation-modal');
    if (existingModal) {
        existingModal.remove();
    }
    
    // Create modal container
    const modalOverlay = document.createElement('div');
    modalOverlay.id = 'confirmation-modal';
    modalOverlay.className = 'modal-overlay';
    
    // Create modal content
    const modalContent = document.createElement('div');
    modalContent.className = 'modal-content';
    
    // Create modal header
    const modalHeader = document.createElement('div');
    modalHeader.className = 'modal-header';
    
    const modalTitle = document.createElement('h3');
    modalTitle.textContent = 'Confirm Action';
    modalHeader.appendChild(modalTitle);
    
    // Create close button
    const closeButton = document.createElement('button');
    closeButton.className = 'close-button';
    closeButton.innerHTML = '×';
    closeButton.setAttribute('title', 'Close');
    closeButton.addEventListener('click', () => modalOverlay.remove());
    modalHeader.appendChild(closeButton);
    
    // Create modal body
    const modalBody = document.createElement('div');
    modalBody.className = 'modal-body';
    
    const messageElement = document.createElement('p');
    messageElement.textContent = message;
    modalBody.appendChild(messageElement);
    
    // Create modal footer with buttons
    const modalFooter = document.createElement('div');
    modalFooter.className = 'modal-footer';
    
    // Cancel button
    const cancelButton = document.createElement('button');
    cancelButton.className = 'cancel-button';
    cancelButton.textContent = cancelText;
    cancelButton.addEventListener('click', () => modalOverlay.remove());
    
    // Confirm button
    const confirmButton = document.createElement('button');
    confirmButton.className = `confirm-button ${isDangerousAction ? 'confirm-delete' : ''}`;
    confirmButton.textContent = confirmText;
    confirmButton.addEventListener('click', () => {
        modalOverlay.remove();
        onConfirm();
    });
    
    modalFooter.appendChild(cancelButton);
    modalFooter.appendChild(confirmButton);
    
    // Assemble modal
    modalContent.appendChild(modalHeader);
    modalContent.appendChild(modalBody);
    modalContent.appendChild(modalFooter);
    modalOverlay.appendChild(modalContent);
    
    // Add modal to DOM
    document.querySelector('main').appendChild(modalOverlay);
    
    // Focus the confirm button
    confirmButton.focus();
    
    // Add keyboard event listener for ESC key
    const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
            modalOverlay.remove();
            document.removeEventListener('keydown', handleKeyDown);
        }
    };
    document.addEventListener('keydown', handleKeyDown);
    
    // Make modal close when clicking outside content
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) {
            modalOverlay.remove();
            document.removeEventListener('keydown', handleKeyDown);
        }
    });
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', initApp);
