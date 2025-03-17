// State management
let tasks = {};
let archivedTasks = []; // Store archived tasks
let dragState = {
    task: null,
    element: null,
    sourceColumn: null,
    sourceIndex: null,
    placeholder: null,
    dragOffsetX: 0,
    dragOffsetY: 0,
    lastTarget: null
};
let isArchiveOpen = false; // Track if archive is open
let lastDragUpdate = null; // Add a variable to track last update time for throttling
let isSaving = false; // Flag to prevent concurrent saves
let saveTasksTimeout = null; // For debounced saving

// Column Configuration - Single source of truth
const COLUMNS_CONFIG = [
    { id: 'todo', name: 'To Do' },
    { id: 'in-progress', name: 'In Progress' },
    { id: 'on-hold', name: 'On Hold' }
];

// Constants
const COLUMNS = COLUMNS_CONFIG.map(column => column.id);
const STORAGE_KEY = 'tasks';
const ARCHIVE_KEY = 'archivedTasks';
const COLUMNS_CONFIG_KEY = 'columnsConfig'; // Storage key for column configuration
const SAVE_DEBOUNCE_DELAY = 300; // Milliseconds to wait before saving

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
 * @returns {Promise} A promise that resolves when the save operation completes
 */
function saveColumnsConfig() {
    return new Promise((resolve, reject) => {
        chrome.storage.local.set({ [COLUMNS_CONFIG_KEY]: COLUMNS_CONFIG }, () => {
            if (chrome.runtime.lastError) {
                console.error('Error saving column configuration:', chrome.runtime.lastError);
                reject(chrome.runtime.lastError);
            } else {
                resolve();
            }
        });
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
                    
                    // Validate task data structure
                    Object.keys(tasks).forEach(columnId => {
                        if (!Array.isArray(tasks[columnId])) {
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
                    archivedTasks = Array.isArray(result[ARCHIVE_KEY]) ? result[ARCHIVE_KEY] : [];
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
 * @returns {Promise} A promise that resolves when the save operation completes
 */
function saveArchivedTasks() {
    return new Promise((resolve, reject) => {
        if (!Array.isArray(archivedTasks)) {
            archivedTasks = [];
        }
        
        chrome.storage.local.set({ [ARCHIVE_KEY]: archivedTasks }, () => {
            if (chrome.runtime.lastError) {
                console.error('Error saving archived tasks:', chrome.runtime.lastError);
                reject(chrome.runtime.lastError);
            } else {
                resolve();
            }
        });
    });
}

/**
 * Debounced save tasks function to prevent excessive storage operations
 */
function debouncedSaveTasks() {
    if (saveTasksTimeout) {
        clearTimeout(saveTasksTimeout);
    }
    
    saveTasksTimeout = setTimeout(() => {
        saveTasksToStorage();
    }, SAVE_DEBOUNCE_DELAY);
}

/**
 * Save tasks to Chrome storage with locking to prevent concurrent saves
 */
function saveTasksToStorage() {
    if (isSaving) return;
    
    isSaving = true;
    
    // Sanitize tasks object
    const sanitizedTasks = {};
    for (const columnId of COLUMNS) {
        if (!tasks[columnId] || !Array.isArray(tasks[columnId])) {
            sanitizedTasks[columnId] = [];
        } else {
            sanitizedTasks[columnId] = tasks[columnId].map(task => ({
                id: task.id || Date.now(),
                text: String(task.text || ''),
                column: task.column || columnId
            }));
        }
    }
    
    chrome.storage.local.set({ [STORAGE_KEY]: sanitizedTasks }, () => {
        isSaving = false;
        if (chrome.runtime.lastError) {
            console.error('Error saving tasks:', chrome.runtime.lastError);
        }
    });
}

/**
 * Save tasks with debouncing
 */
function saveTasks() {
    debouncedSaveTasks();
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
    archiveButton.innerHTML = '<i class="ri-archive-line"></i>';
    
    // Create settings button (on right)
    const settingsButton = document.createElement('button');
    settingsButton.id = 'settings-button';
    settingsButton.className = 'settings-button';
    settingsButton.setAttribute('aria-label', 'Board Settings');
    settingsButton.setAttribute('title', 'Board Settings');
    settingsButton.innerHTML = '<i class="ri-settings-4-line"></i>';
    
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
    try {
        isArchiveOpen = !isArchiveOpen;
        
        // Remove existing archive container
        const existingArchive = document.getElementById('archive-container');
        if (existingArchive) {
            existingArchive.remove();
        }
        
        if (isArchiveOpen) {
            // If opening the archive
            document.getElementById('archive-button').innerHTML = '<i class="ri-arrow-left-line"></i>';
            document.getElementById('archive-button').setAttribute('title', 'Back to Tasks');
            document.getElementById('archive-button').setAttribute('aria-label', 'Back to Tasks');
            
            // Hide main view elements
            document.querySelector('.kanban-board').style.display = 'none';
            document.getElementById('add-task').style.display = 'none';
            document.getElementById('settings-button').style.display = 'none';
            
            // Create the archive view
            createArchiveView();
        } else {
            // If closing the archive, show main view
            document.getElementById('archive-button').innerHTML = '<i class="ri-archive-line"></i>';
            document.getElementById('archive-button').setAttribute('title', 'View Archive');
            document.getElementById('archive-button').setAttribute('aria-label', 'View Archive');
            
            // Show main view elements
            document.querySelector('.kanban-board').style.display = '';
            document.getElementById('add-task').style.display = '';
            document.getElementById('settings-button').style.display = '';
            
            // Render tasks in main view
            renderTasks();
        }
    } catch (error) {
        console.error('Error toggling archive view:', error);
        // Try to recover to a usable state
        isArchiveOpen = false;
        const mainBoard = document.querySelector('.kanban-board');
        const addTaskBtn = document.getElementById('add-task');
        const settingsBtn = document.getElementById('settings-button');
        
        if (mainBoard) mainBoard.style.display = '';
        if (addTaskBtn) addTaskBtn.style.display = '';
        if (settingsBtn) settingsBtn.style.display = '';
        
        const archiveBtn = document.getElementById('archive-button');
        if (archiveBtn) {
            archiveBtn.innerHTML = '<i class="ri-archive-line"></i>';
            archiveBtn.setAttribute('title', 'View Archive');
            archiveBtn.setAttribute('aria-label', 'View Archive');
        }
        
        renderTasks();
    }
}

/**
 * Create and show archive view
 */
function createArchiveView() {
    try {
        // Ensure archivedTasks is an array
        if (!Array.isArray(archivedTasks)) {
            archivedTasks = [];
            saveArchivedTasks();
        }
        
        const archiveContainer = document.createElement('div');
        archiveContainer.id = 'archive-container';
        archiveContainer.className = 'archive-container';
        
        // Create a more compact header for narrow widths
        const headerContainer = document.createElement('div');
        headerContainer.className = 'archive-header-container';
        
        // Archive icon and title in one line - more compact for narrow widths
        const headerTitleRow = document.createElement('div');
        headerTitleRow.className = 'archive-title-row';
        
        const headerIcon = document.createElement('span');
        headerIcon.className = 'header-icon';
        headerIcon.innerHTML = '<i class="ri-archive-line"></i>';
        
        const header = document.createElement('h2');
        header.textContent = 'Archived Tasks';
        header.className = 'archive-title';
        
        headerTitleRow.appendChild(headerIcon);
        headerTitleRow.appendChild(header);
        headerContainer.appendChild(headerTitleRow);
        
        // Add actions row with count badge and clear button - made responsive
        if (archivedTasks.length > 0) {
            // Create a wrapper for actions and search
            const actionsWrapper = document.createElement('div');
            actionsWrapper.className = 'archive-actions-wrapper';
            
            const actionsRow = document.createElement('div');
            actionsRow.className = 'archive-actions-row';
            
            const countBadge = document.createElement('span');
            countBadge.className = 'archive-count-badge';
            countBadge.textContent = archivedTasks.length;
            
            const clearAllButton = document.createElement('button');
            clearAllButton.className = 'clear-all-button';
            clearAllButton.innerHTML = '<i class="ri-delete-bin-line"></i> <span class="button-text">Clear</span>';
            clearAllButton.setAttribute('aria-label', 'Clear all archived tasks');
            clearAllButton.setAttribute('title', 'Delete all archived tasks permanently');
            clearAllButton.addEventListener('click', () => {
                showConfirmationModal(
                    'Delete all archived tasks?',
                    () => {
                        archivedTasks = [];
                        saveArchivedTasks().then(() => {
                            handleArchiveViewUpdate();
                        }).catch(error => {
                            console.error('Error clearing archives:', error);
                        });
                    },
                    'Delete All',
                    'Cancel',
                    true // Mark as dangerous action
                );
            });
            
            actionsRow.appendChild(countBadge);
            actionsRow.appendChild(clearAllButton);
            actionsWrapper.appendChild(actionsRow);
            
            // Add search/filter for archives - styled consistently with action buttons
            if (archivedTasks.length > 5) {
                // Create separate container for search with consistent styling
                const searchContainer = document.createElement('div');
                searchContainer.className = 'archive-search-container';
                
                const searchWrapper = document.createElement('div');
                searchWrapper.className = 'archive-search-wrapper';
                
                const searchIcon = document.createElement('i');
                searchIcon.className = 'ri-search-line search-icon';
                
                const searchInput = document.createElement('input');
                searchInput.type = 'text';
                searchInput.className = 'archive-search';
                searchInput.placeholder = 'Filter...';
                searchInput.setAttribute('aria-label', 'Filter archived tasks');
                
                searchWrapper.appendChild(searchIcon);
                searchWrapper.appendChild(searchInput);
                searchContainer.appendChild(searchWrapper);
                
                // Add search container to actions wrapper
                actionsWrapper.appendChild(searchContainer);
                
                // Add listener for filtering
                let filterTimeout;
                searchInput.addEventListener('input', () => {
                    // Debounce filtering
                    if (filterTimeout) {
                        clearTimeout(filterTimeout);
                    }
                    
                    filterTimeout = setTimeout(() => {
                        const filterText = searchInput.value.toLowerCase().trim();
                        const archiveItems = document.querySelectorAll('.archived-task');
                        
                        archiveItems.forEach(item => {
                            const taskText = item.querySelector('.task-text')?.textContent?.toLowerCase() || '';
                            const columnName = item.querySelector('.column-badge')?.textContent?.toLowerCase() || '';
                            
                            if (filterText === '' || 
                                taskText.includes(filterText) || 
                                columnName.includes(filterText)) {
                                item.style.display = '';
                            } else {
                                item.style.display = 'none';
                            }
                        });
                        
                        // Show/hide empty state based on visible items
                        const hasVisibleItems = Array.from(archiveItems).some(item => item.style.display !== 'none');
                        const emptyState = document.querySelector('.empty-filtered-archive');
                        
                        if (!hasVisibleItems && filterText !== '') {
                            // Create empty state if it doesn't exist
                            if (!emptyState) {
                                const emptyFilteredState = document.createElement('div');
                                emptyFilteredState.className = 'empty-filtered-archive';
                                emptyFilteredState.innerHTML = `<i class="ri-file-search-line"></i><p>No matches</p>`;
                                
                                const tasksList = document.querySelector('.archived-tasks');
                                if (tasksList) {
                                    tasksList.appendChild(emptyFilteredState);
                                }
                            } else {
                                emptyState.innerHTML = `<i class="ri-file-search-line"></i><p>No matches</p>`;
                                emptyState.style.display = '';
                            }
                        } else if (emptyState) {
                            // Hide empty state if we have items
                            emptyState.style.display = 'none';
                        }
                    }, 200);
                });
            }
            
            // Add the actions wrapper to the header
            headerContainer.appendChild(actionsWrapper);
        }
        
        archiveContainer.appendChild(headerContainer);
        
        // Add a subtle divider
        const divider = document.createElement('div');
        divider.className = 'archive-divider';
        archiveContainer.appendChild(divider);
        
        if (archivedTasks.length === 0) {
            // Simplified empty state for narrow widths
            const emptyStateContainer = document.createElement('div');
            emptyStateContainer.className = 'empty-archive-container';
            
            const emptyIcon = document.createElement('div');
            emptyIcon.className = 'empty-archive-icon';
            emptyIcon.innerHTML = '<i class="ri-inbox-archive-line"></i>';
            
            const emptyMessage = document.createElement('p');
            emptyMessage.className = 'empty-archive-message';
            emptyMessage.textContent = 'No archived tasks';
            
            emptyStateContainer.appendChild(emptyIcon);
            emptyStateContainer.appendChild(emptyMessage);
            
            archiveContainer.appendChild(emptyStateContainer);
        } else {
            // Create space-efficient list of archived tasks for narrow widths
            const tasksList = document.createElement('div');
            tasksList.className = 'archived-tasks';
            
            // Use DocumentFragment for better performance when creating many elements
            const fragment = document.createDocumentFragment();
            
            archivedTasks.forEach((archivedTask, index) => {
                if (!archivedTask || typeof archivedTask !== 'object') {
                    console.warn('Invalid archived task, skipping', archivedTask);
                    return;
                }
                
                const taskElement = document.createElement('div');
                taskElement.className = 'archived-task';
                
                // Create top row with column badge
                const taskHeader = document.createElement('div');
                taskHeader.className = 'archived-task-header';
                
                // Column badge with responsive styling
                const columnBadge = document.createElement('span');
                columnBadge.className = 'column-badge';
                
                // Find the column name from its ID
                const columnConfig = COLUMNS_CONFIG.find(col => col.id === archivedTask.column);
                const columnName = columnConfig ? columnConfig.name : archivedTask.column;
                
                // Add column icon based on name - use shorter names for narrow widths
                let columnIcon = '';
                let displayName = columnName || 'Unknown';
                
                // For very narrow widths, use abbreviated column names
                if (columnName) {
                    if (columnName.toLowerCase().includes('todo') || columnName.toLowerCase().includes('to do')) {
                        columnIcon = '<i class="ri-checkbox-blank-circle-line"></i> ';
                        displayName = columnName.length > 10 ? 'Todo' : displayName;
                    } else if (columnName.toLowerCase().includes('progress') || columnName.toLowerCase().includes('doing')) {
                        columnIcon = '<i class="ri-loader-2-line"></i> ';
                        displayName = columnName.length > 10 ? 'In Progress' : displayName;
                    } else if (columnName.toLowerCase().includes('hold') || columnName.toLowerCase().includes('wait')) {
                        columnIcon = '<i class="ri-pause-circle-line"></i> ';
                        displayName = columnName.length > 10 ? 'On Hold' : displayName;
                    } else if (columnName.toLowerCase().includes('done') || columnName.toLowerCase().includes('complete')) {
                        columnIcon = '<i class="ri-checkbox-circle-line"></i> ';
                        displayName = columnName.length > 10 ? 'Done' : displayName;
                    } else {
                        columnIcon = '<i class="ri-list-check"></i> ';
                    }
                }
                
                columnBadge.innerHTML = columnIcon + displayName;
                taskHeader.appendChild(columnBadge);
                
                // Add date in smaller format if available
                if (archivedTask.archivedAt) {
                    const dateElement = document.createElement('div');
                    dateElement.className = 'archive-date';
                    
                    const dateText = document.createElement('span');
                    try {
                        const date = new Date(archivedTask.archivedAt);
                        // Format as shorter date for narrow widths (MM/DD)
                        if (!isNaN(date.getTime())) {
                            const options = { month: 'numeric', day: 'numeric' };
                            dateText.textContent = date.toLocaleDateString(undefined, options);
                        } else {
                            dateText.textContent = '-';
                        }
                    } catch (e) {
                        dateText.textContent = '-';
                    }
                    
                    dateElement.appendChild(dateText);
                    taskHeader.appendChild(dateElement);
                }
                
                taskElement.appendChild(taskHeader);
                
                // Task text with improved styling for narrow widths
                const taskContent = document.createElement('div');
                taskContent.className = 'archived-task-content';
                
                const taskText = document.createElement('p');
                taskText.textContent = archivedTask.text || 'No content';
                taskText.className = 'task-text';
                
                taskContent.appendChild(taskText);
                taskElement.appendChild(taskContent);
                
                // Button container with improved styling for narrow widths
                const buttonContainer = document.createElement('div');
                buttonContainer.className = 'archive-button-container';
                
                // Restore button with icon only - more compact for narrow widths
                const restoreButton = document.createElement('button');
                restoreButton.className = 'restore-button';
                restoreButton.innerHTML = '<i class="ri-refresh-line"></i>';
                restoreButton.setAttribute('title', 'Restore');
                restoreButton.setAttribute('aria-label', 'Restore task');
                restoreButton.addEventListener('click', () => restoreTask(index));
                
                // Delete button with icon only - more compact for narrow widths
                const deleteButton = document.createElement('button');
                deleteButton.className = 'delete-permanently-button';
                deleteButton.innerHTML = '<i class="ri-delete-bin-line"></i>';
                deleteButton.setAttribute('title', 'Delete');
                deleteButton.setAttribute('aria-label', 'Delete task permanently');
                deleteButton.addEventListener('click', () => deleteTaskPermanently(index));
                
                buttonContainer.appendChild(restoreButton);
                buttonContainer.appendChild(deleteButton);
                
                taskElement.appendChild(buttonContainer);
                fragment.appendChild(taskElement);
            });
            
            tasksList.appendChild(fragment);
            archiveContainer.appendChild(tasksList);
        }
        
        // Insert the archive container into the DOM
        document.querySelector('main').appendChild(archiveContainer);
        
        // Add CSS custom properties for styling
        const root = document.documentElement;
        root.style.setProperty('--archive-container-width', window.innerWidth + 'px');
        root.style.setProperty('--archive-header-spacing', '12px');
        
        // Apply responsive styles based on width
        const applyResponsiveStyles = () => {
            const width = window.innerWidth;
            
            if (width <= 400) {
                root.style.setProperty('--archive-header-layout', 'column');
                root.style.setProperty('--archive-actions-layout', 'column');
                root.style.setProperty('--archive-actions-spacing', '8px');
                root.style.setProperty('--search-width', '100%');
            } else {
                root.style.setProperty('--archive-header-layout', 'row wrap');
                root.style.setProperty('--archive-actions-layout', 'row');
                root.style.setProperty('--archive-actions-spacing', '12px');
                root.style.setProperty('--search-width', '180px');
            }
        };
        
        // Initialize responsive styles
        applyResponsiveStyles();
        
        // Update on resize
        const handleResize = () => {
            root.style.setProperty('--archive-container-width', window.innerWidth + 'px');
            applyResponsiveStyles();
        };
        
        window.addEventListener('resize', handleResize);
        
        // Store resize handler on the container to remove it later
        archiveContainer.dataset.resizeHandler = true;
        
        // Add CSS for consistent styling between buttons and search
        const style = document.createElement('style');
        style.textContent = `
            .archive-actions-wrapper {
                display: flex;
                flex-direction: var(--archive-actions-layout, row);
                gap: var(--archive-actions-spacing, 12px);
                margin-top: 8px;
                align-items: center;
                flex-wrap: wrap;
            }
            
            .archive-actions-row {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            .archive-search-container {
                flex: 1;
                min-width: var(--search-width, 180px);
                max-width: 300px;
            }
            
            .archive-search-wrapper {
                position: relative;
                display: flex;
                align-items: center;
                background: var(--input-bg, #f5f5f5);
                border-radius: 4px;
                padding: 0 8px;
                height: 32px;
                border: 1px solid var(--border-color, #ddd);
            }
            
            .search-icon {
                margin-right: 6px;
                color: var(--icon-color, #666);
            }
            
            .archive-search {
                border: none;
                background: transparent;
                outline: none;
                width: 100%;
                font-size: 14px;
                padding: 0;
            }
            
            .archive-count-badge {
                background: var(--badge-bg, #f0f0f0);
                border-radius: 12px;
                padding: 2px 8px;
                font-size: 14px;
                color: var(--text-color, #333);
            }
            
            @media (max-width: 400px) {
                .archive-header-container {
                    padding: 8px;
                }
                
                .archive-actions-wrapper {
                    width: 100%;
                }
                
                .archive-actions-row {
                    width: 100%;
                    justify-content: space-between;
                }
                
                .archive-search-container {
                    width: 100%;
                    max-width: 100%;
                    margin-top: 8px;
                }
            }
        `;
        
        document.head.appendChild(style);
        archiveContainer.dataset.styleAdded = true;
        
    } catch (error) {
        console.error('Error creating archive view:', error);
        // Recover to main view
        isArchiveOpen = false;
        toggleArchiveView();
    }
}

/**
 * Restore a task from the archive
 * @param {number} index - Index of task in archive array
 * @returns {Promise} Promise that resolves when the task is restored
 */
function restoreTask(index) {
    return new Promise((resolve, reject) => {
        try {
            if (index < 0 || index >= archivedTasks.length) {
                console.error('Invalid archive index for restore:', index);
                return reject(new Error('Invalid archive index'));
            }
            
            const taskToRestore = archivedTasks[index];
            if (!taskToRestore || typeof taskToRestore !== 'object') {
                console.error('Invalid task object in archive');
                return reject(new Error('Invalid archived task'));
            }
            
            // Check if the original column still exists
            let targetColumn = taskToRestore.column;
            if (!COLUMNS.includes(targetColumn)) {
                // If not, set it to the first column
                targetColumn = COLUMNS_CONFIG[0]?.id;
                if (!targetColumn) {
                    console.error('No valid columns found');
                    return reject(new Error('No valid columns found'));
                }
            }
            
            // Ensure the target column exists in tasks
            if (!tasks[targetColumn] || !Array.isArray(tasks[targetColumn])) {
                tasks[targetColumn] = [];
            }
            
            // Create a clean task object with ONLY the required properties
            const restoredTask = {
                // Use original ID if available, otherwise create a new one
                id: taskToRestore.id || Date.now(),
                text: String(taskToRestore.text || ''),
                column: targetColumn
            };
            
            // Add to target column
            tasks[targetColumn].push(restoredTask);
            
            // Remove from archive
            archivedTasks.splice(index, 1);
            
            // Save changes with Promise.all for efficiency
            Promise.all([
                saveTasks(),
                saveArchivedTasks()
            ]).then(() => {
                // Update UI based on archive state
                handleArchiveViewUpdate();
                resolve();
            }).catch(error => {
                console.error('Error saving after restore:', error);
                reject(error);
            });
        } catch (error) {
            console.error('Error restoring task:', error);
            reject(error);
        }
    });
}

/**
 * Update the UI after archive changes
 * Helper function to handle common view toggle logic
 */
function handleArchiveViewUpdate() {
    try {
        // Remove archive container completely regardless of archive state
        const existingArchive = document.getElementById('archive-container');
        if (existingArchive) {
            // Remove resize event listener if it was added
            if (existingArchive.dataset.resizeHandler) {
                window.removeEventListener('resize', handleResize);
            }
            
            // Remove the added style if it exists
            if (existingArchive.dataset.styleAdded) {
                const styles = document.head.querySelectorAll('style');
                // Remove the last added style (should be ours)
                if (styles.length > 0) {
                    const lastStyle = styles[styles.length - 1];
                    lastStyle.remove();
                }
            }
            
            existingArchive.remove();
        }
        
        // Ensure archivedTasks is valid
        if (!Array.isArray(archivedTasks)) {
            archivedTasks = [];
            saveArchivedTasks().catch(error => {
                console.error('Error saving empty archives:', error);
            });
        }
        
        if (archivedTasks.length === 0) {
            // If archive is now empty, return to main view
            isArchiveOpen = false;
            
            // Show main view elements
            const mainBoard = document.querySelector('.kanban-board');
            const addTaskBtn = document.getElementById('add-task');
            const settingsBtn = document.getElementById('settings-button');
            
            if (mainBoard) mainBoard.style.display = '';
            if (addTaskBtn) addTaskBtn.style.display = '';
            if (settingsBtn) settingsBtn.style.display = '';
            
            // Reset archive button
            const archiveBtn = document.getElementById('archive-button');
            if (archiveBtn) {
                archiveBtn.innerHTML = '<i class="ri-archive-line"></i>';
                archiveBtn.setAttribute('title', 'View Archive');
                archiveBtn.setAttribute('aria-label', 'View Archive');
            }
            
            // Render tasks in main view
            renderTasks();
        } else {
            // If there are still items in archive, refresh the archive view
            createArchiveView();
        }
    } catch (error) {
        console.error('Error updating archive view:', error);
        // Try to recover to a usable state
        isArchiveOpen = false;
        const mainBoard = document.querySelector('.kanban-board');
        const addTaskBtn = document.getElementById('add-task');
        const settingsBtn = document.getElementById('settings-button');
        
        if (mainBoard) mainBoard.style.display = '';
        if (addTaskBtn) addTaskBtn.style.display = '';
        if (settingsBtn) settingsBtn.style.display = '';
        
        const archiveBtn = document.getElementById('archive-button');
        if (archiveBtn) {
            archiveBtn.innerHTML = '<i class="ri-archive-line"></i>';
            archiveBtn.setAttribute('title', 'View Archive');
            archiveBtn.setAttribute('aria-label', 'View Archive');
        }
        
        renderTasks();
    }
}

// Define handleResize function globally for proper cleanup
function handleResize() {
    document.documentElement.style.setProperty('--archive-container-width', window.innerWidth + 'px');
}

/**
 * Permanently delete a task from the archive
 * @param {number} index - Index of task in archive array
 */
function deleteTaskPermanently(index) {
    try {
        if (index < 0 || index >= archivedTasks.length) {
            console.error('Invalid archive index for delete:', index);
            return;
        }
        
        showConfirmationModal(
            'Are you sure you want to permanently delete this task?',
            () => {
                // Remove from archive
                archivedTasks.splice(index, 1);
                
                // Save changes
                saveArchivedTasks().then(() => {
                    // Update UI based on archive state
                    handleArchiveViewUpdate();
                }).catch(error => {
                    console.error('Error saving after permanent deletion:', error);
                });
            },
            'Delete', 
            'Cancel',
            true // Mark as dangerous action
        );
    } catch (error) {
        console.error('Error initiating permanent delete:', error);
    }
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
    
    // Setup drag and drop for tasks
    setupTaskDragAndDrop();
}

/**
 * Setup drag and drop for tasks
 */
function setupTaskDragAndDrop() {
    document.addEventListener('dragstart', handleTaskDragStart);
    document.addEventListener('dragover', handleTaskDragOver);
    document.addEventListener('dragleave', handleTaskDragLeave);
    document.addEventListener('drop', handleTaskDrop);
    document.addEventListener('dragend', cleanupDragState); // Always clean up on drag end
}

/**
 * Handle the start of dragging a task
 * @param {DragEvent} e - The drag event
 */
function handleTaskDragStart(e) {
    const taskElement = e.target.closest('.task');
    if (!taskElement) return;
    
    // Prevent dragging during edit mode
    if (taskElement.classList.contains('editing')) {
        e.preventDefault();
        return;
    }
    
    // Set task data into the dataTransfer object
    const taskId = parseInt(taskElement.dataset.id);
    const columnId = taskElement.closest('.board')?.id;
    
    if (!taskId || !columnId) {
        console.error('Invalid task element during drag start');
        e.preventDefault();
        return;
    }
    
    try {
        e.dataTransfer.setData('text/plain', JSON.stringify({
            taskId: taskId,
            sourceColumnId: columnId
        }));
        
        // Add a class for styling
        taskElement.classList.add('task-being-dragged');
        
        // Set drag effect
        e.dataTransfer.effectAllowed = 'move';
        
        // This helps with Firefox
        e.dataTransfer.setDragImage(taskElement, 10, 10);
        
        // Add classes to show valid drop targets
        document.querySelectorAll('.tasks').forEach(tasksContainer => {
            tasksContainer.classList.add('valid-drop-target');
        });
    } catch (error) {
        console.error('Error during drag start:', error);
        cleanupDragState();
    }
}

/**
 * Handle dragging over a potential drop target
 * @param {DragEvent} e - The drag event
 */
function handleTaskDragOver(e) {
    // Throttle the drag updates to prevent rapid oscillation
    const now = Date.now();
    if (lastDragUpdate && now - lastDragUpdate < 50) {
        e.preventDefault(); // Still allow the drop
        e.dataTransfer.dropEffect = 'move';
        return; // Skip processing
    }
    lastDragUpdate = now;
    
    try {
        // First try to find the task container directly
        let tasksContainer = e.target.closest('.tasks');
        
        // If that fails, check if we're over a board and use its task container
        if (!tasksContainer) {
            const boardElement = e.target.closest('.board');
            if (boardElement) {
                tasksContainer = boardElement.querySelector('.tasks');
            }
        }
        
        // If we're not over a valid drop target, bail out
        if (!tasksContainer) return;
        
        // Allow the drop
        e.preventDefault();
        
        // Apply drop effect
        e.dataTransfer.dropEffect = 'move';
        
        // Add visual feedback to the container and its board
        document.querySelectorAll('.tasks').forEach(container => {
            container.classList.remove('task-drop-active');
        });
        
        document.querySelectorAll('.board').forEach(board => {
            board.classList.remove('board-drop-active');
        });
        
        tasksContainer.classList.add('task-drop-active');
        tasksContainer.closest('.board')?.classList.add('board-drop-active');
        
        // Find the closest task to show insertion point
        const task = e.target.closest('.task');
        if (task && !task.classList.contains('task-being-dragged')) {
            const rect = task.getBoundingClientRect();
            const middle = rect.top + rect.height / 2;
            
            // Remove indicators from all tasks
            document.querySelectorAll('.task').forEach(t => {
                t.classList.remove('drop-before', 'drop-after');
                // Remove any inline margin styles that might have been applied
                t.style.marginTop = '';
                t.style.marginBottom = '';
            });
            
            if (e.clientY < middle) {
                // Add drop-before class to current task (no margin changes)
                task.classList.add('drop-before');
            } else {
                // Add drop-after class to current task (no margin changes)
                task.classList.add('drop-after');
            }
        } else if (!task) {
            // If over an empty container or between tasks, clear all indicators
            document.querySelectorAll('.task').forEach(t => {
                t.classList.remove('drop-before', 'drop-after');
                // Remove any inline margin styles
                t.style.marginTop = '';
                t.style.marginBottom = '';
            });
        }
    } catch (error) {
        console.error('Error during drag over:', error);
    }
}

/**
 * Handle dropping a task
 * @param {DragEvent} e - The drag event
 */
function handleTaskDrop(e) {
    try {
        // First try to find the task container directly
        let tasksContainer = e.target.closest('.tasks');
        
        // If that fails, check if we're over a board and use its task container
        if (!tasksContainer) {
            const boardElement = e.target.closest('.board');
            if (boardElement) {
                tasksContainer = boardElement.querySelector('.tasks');
            }
        }
        
        // If we still don't have a valid drop target, bail out
        if (!tasksContainer) {
            cleanupDragState();
            return;
        }
        
        // Prevent default browser behavior
        e.preventDefault();
        
        // Get the dragged task data
        let taskId, sourceColumnId;
        try {
            const data = JSON.parse(e.dataTransfer.getData('text/plain'));
            taskId = parseInt(data.taskId);
            sourceColumnId = data.sourceColumnId;
            
            if (!taskId || !sourceColumnId) {
                throw new Error('Invalid drag data');
            }
        } catch (error) {
            console.error('Error parsing drag data:', error);
            cleanupDragState();
            return;
        }
        
        const targetColumnId = tasksContainer.closest('.board')?.id;
        if (!targetColumnId) {
            console.error('Invalid target column');
            cleanupDragState();
            return;
        }
        
        // Find the task in the source column
        if (!tasks[sourceColumnId] || !Array.isArray(tasks[sourceColumnId])) {
            console.error('Invalid source column tasks array');
            cleanupDragState();
            return;
        }
        
        const taskIndex = tasks[sourceColumnId].findIndex(task => task.id === taskId);
        if (taskIndex === -1) {
            console.error('Task not found in source column');
            cleanupDragState();
            return;
        }
        
        // Check target column is valid
        if (!tasks[targetColumnId] || !Array.isArray(tasks[targetColumnId])) {
            tasks[targetColumnId] = [];
        }
        
        // Determine insert position
        let insertIndex = tasks[targetColumnId].length;
        const taskElementUnder = e.target.closest('.task');
        
        if (taskElementUnder && !taskElementUnder.classList.contains('task-being-dragged')) {
            const taskIdUnder = parseInt(taskElementUnder.dataset.id);
            const taskIndexUnder = tasks[targetColumnId].findIndex(task => task.id === taskIdUnder);
            
            if (taskIndexUnder !== -1) {
                const rect = taskElementUnder.getBoundingClientRect();
                const middle = rect.top + rect.height / 2;
                
                if (e.clientY < middle) {
                    // Insert before
                    insertIndex = taskIndexUnder;
                } else {
                    // Insert after
                    insertIndex = taskIndexUnder + 1;
                }
            }
        }
        
        // Move the task
        const taskToMove = { ...tasks[sourceColumnId][taskIndex], column: targetColumnId };
        
        // Remove from source
        tasks[sourceColumnId].splice(taskIndex, 1);
        
        // Add to target
        tasks[targetColumnId].splice(insertIndex, 0, taskToMove);
        
        // Save and render
        saveTasks();
        renderTasks();
        
        // Add animation class to the moved task
        setTimeout(() => {
            const movedTask = document.querySelector(`#${targetColumnId} .task[data-id="${taskId}"]`);
            if (movedTask) {
                movedTask.classList.add('task-just-moved');
                
                // Remove the class after animation completes
                setTimeout(() => {
                    movedTask.classList.remove('task-just-moved');
                }, 500);
            }
        }, 10);
    } catch (error) {
        console.error('Error during drag drop:', error);
    } finally {
        // Always clean up drag state
        cleanupDragState();
    }
}

/**
 * Clean up any drag related state and classes
 */
function cleanupDragState() {
    // Reset all task margins
    document.querySelectorAll('.task').forEach(task => {
        task.style.marginTop = '';
        task.style.marginBottom = '';
    });
    
    // Remove all drag classes
    document.querySelectorAll('.task').forEach(task => {
        task.classList.remove('task-being-dragged', 'drop-before', 'drop-after');
    });
    
    document.querySelectorAll('.tasks').forEach(container => {
        container.classList.remove('valid-drop-target', 'task-drop-active');
    });
    
    // Remove board highlight classes
    document.querySelectorAll('.board').forEach(board => {
        board.classList.remove('board-drop-active');
    });
}

/**
 * Handle dragging out of a drop target
 * @param {DragEvent} e - The drag event
 */
function handleTaskDragLeave(e) {
    try {
        // Check if we're leaving a task container
        const tasksContainer = e.target.closest('.tasks');
        const boardElement = e.target.closest('.board');
        
        // Check if we've really left the container by seeing if the related target is still within it
        let hasLeftTasksContainer = false;
        let hasLeftBoardElement = false;
        
        if (tasksContainer && (!e.relatedTarget || !tasksContainer.contains(e.relatedTarget))) {
            hasLeftTasksContainer = true;
        }
        
        if (boardElement && (!e.relatedTarget || !boardElement.contains(e.relatedTarget))) {
            hasLeftBoardElement = true;
        }
        
        // If we've truly left a container (not just moved to a child element)
        if (hasLeftTasksContainer) {
            // Remove highlight from this container
            tasksContainer.classList.remove('task-drop-active');
            
            // Reset any indicators within this container
            tasksContainer.querySelectorAll('.task').forEach(task => {
                task.classList.remove('drop-before', 'drop-after');
                task.style.marginTop = '';
                task.style.marginBottom = '';
            });
        }
        
        // If we've truly left a board
        if (hasLeftBoardElement) {
            boardElement.classList.remove('board-drop-active');
        }
    } catch (error) {
        console.error('Error during drag leave:', error);
    }
}

/**
 * Handle adding a new task
 */
function handleAddTask() {
    try {
        const taskId = Date.now();
        const taskEl = createEditableTask(taskId);
        
        // Use the first column from configuration
        const firstColumnId = COLUMNS_CONFIG[0]?.id;
        if (!firstColumnId) {
            console.error('No columns configured');
            return;
        }
        
        const firstColumnTasksDiv = document.querySelector(`#${firstColumnId} .tasks`);
        
        if (firstColumnTasksDiv) {
            firstColumnTasksDiv.insertBefore(taskEl, firstColumnTasksDiv.firstChild);
            
            const input = taskEl.querySelector('.task-input');
            if (input) {
                input.focus();
                
                // Set a removal timeout - if the user doesn't enter anything in 30 seconds, remove the empty task
                const emptyTaskTimeout = setTimeout(() => {
                    if (taskEl.parentNode && (!input.value || !input.value.trim())) {
                        taskEl.remove();
                    }
                }, 30000);
                
                // Store the timeout ID on the element
                taskEl.dataset.timeoutId = emptyTaskTimeout;
            }
        } else {
            console.error(`First column tasks container (#${firstColumnId} .tasks) not found`);
        }
    } catch (error) {
        console.error('Error adding new task:', error);
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
    input.setAttribute('aria-label', 'Task description');
    input.maxLength = 500; // Reasonable limit for task text

    input.addEventListener('blur', () => {
        try {
            // Clear any pending auto-remove timeout
            if (taskEl.dataset.timeoutId) {
                clearTimeout(parseInt(taskEl.dataset.timeoutId));
                delete taskEl.dataset.timeoutId;
            }
            
            if (input.value.trim()) {
                // Use the first column from configuration
                const firstColumnId = COLUMNS_CONFIG[0]?.id;
                if (!firstColumnId) {
                    console.error('No columns configured');
                    taskEl.remove();
                    return;
                }
                
                if (!tasks[firstColumnId]) {
                    tasks[firstColumnId] = [];
                }
                
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
        } catch (error) {
            console.error('Error saving new task:', error);
            taskEl.remove();
        }
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            input.blur();
        } else if (e.key === 'Escape') {
            // Remove the task on escape without saving
            taskEl.remove();
            
            // Clear any pending timeout
            if (taskEl.dataset.timeoutId) {
                clearTimeout(parseInt(taskEl.dataset.timeoutId));
            }
        }
    });

    taskEl.appendChild(input);
    return taskEl;
}

/**
 * Render all tasks across columns
 */
function renderTasks() {
    try {
        // Ensure all columns are initialized
        COLUMNS.forEach(column => {
            if (!tasks[column] || !Array.isArray(tasks[column])) {
                tasks[column] = [];
            }
        });
        
        COLUMNS.forEach(column => {
            const tasksDiv = document.querySelector(`#${column} .tasks`);
            if (!tasksDiv) {
                console.warn(`Tasks container for column ${column} not found`);
                return;
            }
            
            // Store scroll position
            const scrollTop = tasksDiv.scrollTop;
            
            tasksDiv.innerHTML = '';
            
            if (!tasks[column] || !Array.isArray(tasks[column])) {
                console.error(`Invalid tasks for column: ${column}`);
                return;
            }
            
            // Sort to ensure order stability (optional)
            const columnTasks = [...tasks[column]];
            
            columnTasks.forEach(task => {
                if (!task || typeof task !== 'object') {
                    console.warn('Invalid task object, skipping render');
                    return;
                }
                
                const taskEl = document.createElement('div');
                taskEl.classList.add('task');
                taskEl.draggable = true;
                taskEl.dataset.id = task.id;
                taskEl.setAttribute('aria-label', `Task: ${task.text}`);
                
                const deleteBtn = document.createElement('button');
                deleteBtn.classList.add('delete-task');
                deleteBtn.innerHTML = '<i class="ri-delete-bin-line"></i>';
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent bubbling to double-click handler
                    deleteTask(task.id, column);
                });
                deleteBtn.setAttribute('aria-label', 'Delete task');
                deleteBtn.setAttribute('title', 'Delete task (moves to archive)');
                
                const textContent = document.createElement('p');
                textContent.textContent = task.text || '';
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
            
            // Restore scroll position
            tasksDiv.scrollTop = scrollTop;
        });
    } catch (error) {
        console.error('Error rendering tasks:', error);
    }
}

/**
 * Make a task editable
 * @param {HTMLElement} taskEl - Task element
 * @param {Object} task - Task data
 */
function makeTaskEditable(taskEl, task) {
    try {
        if (!taskEl || !task) return;
        
        taskEl.draggable = false;
        taskEl.classList.add('editing');
        
        // Save original content to restore if needed
        const originalContent = task.text || '';
        
        const input = document.createElement('input');
        input.type = 'text';
        input.classList.add('task-input');
        input.value = originalContent;
        input.maxLength = 500; // Reasonable limit for task text
        
        // Clear the task element
        taskEl.textContent = '';
        taskEl.appendChild(input);
        input.focus();
        input.select(); // Select all text for easy editing
        
        // Handle finishing edit on blur
        input.addEventListener('blur', () => {
            finishEditing(taskEl, task, input.value.trim(), originalContent);
        });
        
        // Handle keyboard events
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                input.blur(); // Save on enter
            } else if (e.key === 'Escape') {
                // Restore original text on escape
                input.value = originalContent;
                input.blur();
            }
        });
    } catch (error) {
        console.error('Error making task editable:', error);
        renderTasks(); // Recover UI state
    }
}

/**
 * Finish editing a task
 * @param {HTMLElement} taskEl - Task element
 * @param {Object} task - Task data
 * @param {string} newText - New task text
 * @param {string} originalText - Original task text
 */
function finishEditing(taskEl, task, newText, originalText) {
    try {
        if (newText && newText !== originalText) {
            task.text = newText;
            saveTasks();
        } else if (!newText) {
            // If empty, restore original text
            task.text = originalText;
        }
        renderTasks();
    } catch (error) {
        console.error('Error finishing task edit:', error);
        renderTasks(); // Recover UI state
    }
}

/**
 * Delete a task (now moves to archive instead)
 * @param {number} taskId - Task ID
 * @param {string} column - Column ID
 */
function deleteTask(taskId, column) {
    try {
        if (!tasks[column] || !Array.isArray(tasks[column])) {
            console.error(`Column not found or invalid: ${column}`);
            return;
        }
        
        // Find the task
        const taskIndex = tasks[column].findIndex(task => task.id === taskId);
        
        if (taskIndex !== -1) {
            const taskToArchive = tasks[column][taskIndex];
            
            // Validate the task object before archiving
            if (!taskToArchive || typeof taskToArchive !== 'object') {
                console.error('Invalid task object, cannot archive');
                return;
            }
            
            // Create a clean archive object with only the necessary properties
            const archiveObject = {
                id: taskToArchive.id,
                text: String(taskToArchive.text || ''),
                column: column,
                archivedAt: Date.now()
            };
            
            // Ensure archivedTasks is an array
            if (!Array.isArray(archivedTasks)) {
                archivedTasks = [];
            }
            
            // Add to archive with timestamp and preserve the original ID
            archivedTasks.push(archiveObject);
            
            // Remove from active tasks
            tasks[column].splice(taskIndex, 1);
            
            // Save both active tasks and archive
            Promise.all([
                saveTasks(),
                saveArchivedTasks()
            ]).catch(error => {
                console.error('Error saving after task deletion:', error);
            });
            
            // Refresh the UI
            renderTasks();
        }
    } catch (error) {
        console.error('Error deleting task:', error);
    }
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
    try {
        // Remove any existing confirmation modal
        const existingModal = document.getElementById('confirmation-modal');
        if (existingModal) {
            existingModal.remove();
        }
        
        // Create modal container
        const modalOverlay = document.createElement('div');
        modalOverlay.id = 'confirmation-modal';
        modalOverlay.className = 'modal-overlay';
        modalOverlay.setAttribute('role', 'dialog');
        modalOverlay.setAttribute('aria-modal', 'true');
        modalOverlay.setAttribute('aria-labelledby', 'confirmation-title');
        modalOverlay.setAttribute('aria-describedby', 'confirmation-message');
        
        // Create modal content
        const modalContent = document.createElement('div');
        modalContent.className = 'modal-content';
        
        // Create modal header
        const modalHeader = document.createElement('div');
        modalHeader.className = 'modal-header';
        
        const modalTitle = document.createElement('h3');
        modalTitle.id = 'confirmation-title';
        modalTitle.textContent = isDangerousAction ? 'Confirm Deletion' : 'Confirm Action';
        modalHeader.appendChild(modalTitle);
        
        // Create close button
        const closeButton = document.createElement('button');
        closeButton.className = 'close-button';
        closeButton.innerHTML = '×';
        closeButton.setAttribute('title', 'Close');
        closeButton.setAttribute('aria-label', 'Close dialog');
        closeButton.addEventListener('click', () => {
            modalOverlay.remove();
            document.removeEventListener('keydown', handleKeyDown);
        });
        modalHeader.appendChild(closeButton);
        
        // Create modal body
        const modalBody = document.createElement('div');
        modalBody.className = 'modal-body';
        
        const messageElement = document.createElement('p');
        messageElement.id = 'confirmation-message';
        messageElement.textContent = message;
        modalBody.appendChild(messageElement);
        
        // Create modal footer with buttons
        const modalFooter = document.createElement('div');
        modalFooter.className = 'modal-footer';
        
        // Cancel button
        const cancelButton = document.createElement('button');
        cancelButton.className = 'cancel-button';
        cancelButton.textContent = cancelText;
        cancelButton.addEventListener('click', () => {
            modalOverlay.remove();
            document.removeEventListener('keydown', handleKeyDown);
        });
        
        // Confirm button
        const confirmButton = document.createElement('button');
        confirmButton.className = `confirm-button ${isDangerousAction ? 'confirm-delete' : ''}`;
        confirmButton.textContent = confirmText;
        confirmButton.addEventListener('click', () => {
            modalOverlay.remove();
            document.removeEventListener('keydown', handleKeyDown);
            
            try {
                onConfirm();
            } catch (error) {
                console.error('Error in confirmation callback:', error);
            }
        });
        
        // Order buttons based on danger level - for dangerous actions, put Cancel first
        if (isDangerousAction) {
            modalFooter.appendChild(cancelButton);
            modalFooter.appendChild(confirmButton);
        } else {
            modalFooter.appendChild(confirmButton);
            modalFooter.appendChild(cancelButton);
        }
        
        // Assemble modal
        modalContent.appendChild(modalHeader);
        modalContent.appendChild(modalBody);
        modalContent.appendChild(modalFooter);
        modalOverlay.appendChild(modalContent);
        
        // Add modal to DOM
        document.querySelector('main').appendChild(modalOverlay);
        
        // Focus the appropriate button based on action type
        // For dangerous actions, focus Cancel button, otherwise focus Confirm
        if (isDangerousAction) {
            cancelButton.focus();
        } else {
            confirmButton.focus();
        }
        
        // Add keyboard event listener for ESC key and Enter key
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                modalOverlay.remove();
                document.removeEventListener('keydown', handleKeyDown);
            } else if (e.key === 'Enter' && document.activeElement === confirmButton) {
                confirmButton.click();
            } else if (e.key === 'Enter' && document.activeElement === cancelButton) {
                cancelButton.click();
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
    } catch (error) {
        console.error('Error showing confirmation modal:', error);
        // Execute callback directly if modal fails
        if (typeof onConfirm === 'function') {
            onConfirm();
        }
    }
}

/**
 * Open kanban settings popup
 */
function openKanbanSettings() {
    try {
        // Hide any existing settings modal
        const existingModal = document.getElementById('settings-modal');
        if (existingModal) {
            existingModal.remove();
        }
        
        // Create modal overlay (darkening background)
        const modalOverlay = document.createElement('div');
        modalOverlay.id = 'settings-modal-overlay';
        modalOverlay.className = 'modal-overlay';
        modalOverlay.setAttribute('role', 'dialog');
        modalOverlay.setAttribute('aria-modal', 'true');
        modalOverlay.setAttribute('aria-labelledby', 'settings-title');
        
        // Create settings modal
        const modal = document.createElement('div');
        modal.id = 'settings-modal';
        modal.className = 'settings-modal';
        
        // Modal header
        const header = document.createElement('div');
        header.className = 'settings-header';
        
        const title = document.createElement('h2');
        title.id = 'settings-title';
        title.textContent = 'Board Settings';
        
        const closeButton = document.createElement('button');
        closeButton.className = 'close-button';
        closeButton.innerHTML = '×';
        closeButton.setAttribute('title', 'Close');
        closeButton.setAttribute('aria-label', 'Close settings');
        closeButton.addEventListener('click', () => {
            modalOverlay.remove();
            document.removeEventListener('keydown', handleKeyDown);
        });
        
        header.appendChild(title);
        header.appendChild(closeButton);
        modal.appendChild(header);
        
        // Column list
        const columnList = document.createElement('div');
        columnList.className = 'column-list';
        columnList.setAttribute('role', 'list');
        columnList.setAttribute('aria-label', 'Column list');
        
        // Keep track of column edits to apply at save time
        const columnEdits = [];
        
        // Create entries for each existing column
        COLUMNS_CONFIG.forEach((column, index) => {
            if (!column || typeof column !== 'object') return;
            
            const columnItem = document.createElement('div');
            columnItem.className = 'column-item';
            columnItem.draggable = true;
            columnItem.dataset.id = column.id;
            columnItem.dataset.index = index;
            columnItem.setAttribute('role', 'listitem');
            
            // Add to columnEdits to keep track of this item
            columnEdits.push({
                originalId: column.id,
                originalName: column.name,
                id: column.id,
                name: column.name,
                element: columnItem,
                isRemoved: false,
                isNew: false
            });
            
            // Drag handle
            const dragHandle = document.createElement('div');
            dragHandle.className = 'drag-handle';
            dragHandle.innerHTML = '<i class="ri-drag-move-fill"></i>';
            dragHandle.setAttribute('title', 'Drag to reorder');
            dragHandle.setAttribute('aria-label', 'Drag to reorder column');
            
            // Column input (for name)
            const columnInput = document.createElement('input');
            columnInput.type = 'text';
            columnInput.className = 'column-name-input';
            columnInput.value = column.name || '';
            columnInput.dataset.id = column.id;
            columnInput.setAttribute('aria-label', 'Column name');
            columnInput.maxLength = 30; // Reasonable limit for column names
            
            // Update columnEdits on input change
            columnInput.addEventListener('input', () => {
                const editEntry = columnEdits.find(entry => entry.id === column.id);
                if (editEntry) {
                    editEntry.name = columnInput.value.trim();
                }
            });
            
            // Remove column button
            const removeButton = document.createElement('button');
            removeButton.className = 'remove-column-button';
            removeButton.innerHTML = '<i class="ri-delete-bin-line"></i>';
            removeButton.setAttribute('title', 'Remove Column');
            removeButton.setAttribute('aria-label', 'Remove column');
            
            // Disable removing if it's the last column
            if (COLUMNS_CONFIG.length <= 1) {
                removeButton.disabled = true;
                removeButton.setAttribute('title', 'Cannot remove the last column');
            }
            
            removeButton.addEventListener('click', () => {
                if (COLUMNS_CONFIG.length > 1) {
                    // Apply animation and mark as removed
                    columnItem.classList.add('removing');
                    
                    // Update columnEdits to mark this as removed
                    const editEntry = columnEdits.find(entry => entry.id === column.id);
                    if (editEntry) {
                        editEntry.isRemoved = true;
                    }
                    
                    setTimeout(() => columnItem.remove(), 300);
                    
                    // Enable/disable buttons based on remaining columns
                    const visibleColumns = columnEdits.filter(col => !col.isRemoved);
                    if (visibleColumns.length <= 1) {
                        // If only one column will remain, disable all remove buttons
                        columnList.querySelectorAll('.remove-column-button').forEach(button => {
                            button.disabled = true;
                            button.setAttribute('title', 'Cannot remove the last column');
                        });
                    }
                }
            });
            
            // Add all elements to the column item
            columnItem.appendChild(dragHandle);
            columnItem.appendChild(columnInput);
            columnItem.appendChild(removeButton);
            
            // Set up drag and drop
            columnItem.addEventListener('dragstart', (e) => {
                columnItem.classList.add('dragging-column');
                e.dataTransfer.setData('text/plain', column.id);
                e.dataTransfer.effectAllowed = 'move';
            });
            
            columnItem.addEventListener('dragend', () => {
                columnItem.classList.remove('dragging-column');
            });
            
            columnList.appendChild(columnItem);
        });
        
        // Add dragover event listener to column list
        columnList.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            
            const draggingItem = columnList.querySelector('.dragging-column');
            if (!draggingItem) return;
            
            const siblings = [...columnList.querySelectorAll('.column-item:not(.dragging-column):not(.removing)')];
            const nextSibling = siblings.find(sibling => {
                return e.clientY < sibling.getBoundingClientRect().top + sibling.getBoundingClientRect().height / 2;
            });
            
            // Clear existing drop indicators
            siblings.forEach(item => {
                item.classList.remove('drag-above', 'drag-below');
            });
            
            // Add indicator on the appropriate item
            if (nextSibling) {
                nextSibling.classList.add('drag-above');
            } else if (siblings.length > 0) {
                siblings[siblings.length - 1].classList.add('drag-below');
            }
        });
        
        columnList.addEventListener('dragleave', () => {
            // Clear indicators when leaving the list
            columnList.querySelectorAll('.column-item').forEach(item => {
                item.classList.remove('drag-above', 'drag-below');
            });
        });
        
        columnList.addEventListener('drop', (e) => {
            e.preventDefault();
            
            const draggedId = e.dataTransfer.getData('text/plain');
            const draggingItem = columnList.querySelector('.dragging-column');
            
            if (!draggingItem) return;
            
            // Find insertion point
            const siblings = [...columnList.querySelectorAll('.column-item:not(.dragging-column):not(.removing)')];
            const nextSibling = siblings.find(sibling => {
                return e.clientY < sibling.getBoundingClientRect().top + sibling.getBoundingClientRect().height / 2;
            });
            
            // Insert dragged item
            if (nextSibling) {
                columnList.insertBefore(draggingItem, nextSibling);
            } else {
                columnList.appendChild(draggingItem);
            }
            
            // Clear drop indicators
            columnList.querySelectorAll('.column-item').forEach(item => {
                item.classList.remove('drag-above', 'drag-below');
            });
        });
        
        // Add new column button
        const addColumnButton = document.createElement('button');
        addColumnButton.className = 'add-column-button';
        addColumnButton.innerHTML = '<i class="ri-add-line"></i> Add New Column';
        addColumnButton.setAttribute('aria-label', 'Add new column');
        addColumnButton.addEventListener('click', () => {
            // Generate a unique ID for the new column
            const newId = 'column-' + Date.now();
            
            // Create new column item
            const columnItem = document.createElement('div');
            columnItem.className = 'column-item new-column';
            columnItem.draggable = true;
            columnItem.dataset.id = newId;
            columnItem.setAttribute('role', 'listitem');
            
            // Add to columnEdits
            columnEdits.push({
                id: newId,
                name: 'New Column',
                element: columnItem,
                isRemoved: false,
                isNew: true
            });
            
            // Drag handle
            const dragHandle = document.createElement('div');
            dragHandle.className = 'drag-handle';
            dragHandle.innerHTML = '<i class="ri-drag-move-fill"></i>';
            dragHandle.setAttribute('title', 'Drag to reorder');
            dragHandle.setAttribute('aria-label', 'Drag to reorder column');
            
            // Column input
            const columnInput = document.createElement('input');
            columnInput.type = 'text';
            columnInput.className = 'column-name-input';
            columnInput.value = 'New Column';
            columnInput.dataset.id = newId;
            columnInput.setAttribute('aria-label', 'Column name');
            columnInput.maxLength = 30; // Reasonable limit for column names
            
            // Update columnEdits on input change
            columnInput.addEventListener('input', () => {
                const editEntry = columnEdits.find(entry => entry.id === newId);
                if (editEntry) {
                    editEntry.name = columnInput.value.trim();
                }
            });
            
            // Remove button
            const removeButton = document.createElement('button');
            removeButton.className = 'remove-column-button';
            removeButton.innerHTML = '<i class="ri-delete-bin-line"></i>';
            removeButton.setAttribute('title', 'Remove Column');
            removeButton.setAttribute('aria-label', 'Remove column');
            removeButton.addEventListener('click', () => {
                // Mark as removed in columnEdits
                const editEntry = columnEdits.find(entry => entry.id === newId);
                if (editEntry) {
                    editEntry.isRemoved = true;
                }
                
                columnItem.classList.add('removing');
                setTimeout(() => columnItem.remove(), 300);
            });
            
            // Add all elements to column item
            columnItem.appendChild(dragHandle);
            columnItem.appendChild(columnInput);
            columnItem.appendChild(removeButton);
            
            // Set up drag and drop
            columnItem.addEventListener('dragstart', (e) => {
                columnItem.classList.add('dragging-column');
                e.dataTransfer.setData('text/plain', newId);
                e.dataTransfer.effectAllowed = 'move';
            });
            
            columnItem.addEventListener('dragend', () => {
                columnItem.classList.remove('dragging-column');
            });
            
            columnList.appendChild(columnItem);
            
            // Focus on new input
            columnInput.focus();
            columnInput.select();
            
            // Enable all remove buttons since we now have more than one column
            columnList.querySelectorAll('.remove-column-button').forEach(button => {
                button.disabled = false;
                button.setAttribute('title', 'Remove Column');
            });
        });
        
        modal.appendChild(columnList);
        modal.appendChild(addColumnButton);
        
        // Save button
        const saveButton = document.createElement('button');
        saveButton.className = 'save-settings-button';
        saveButton.textContent = 'Save Changes';
        saveButton.setAttribute('aria-label', 'Save column changes');
        saveButton.addEventListener('click', () => {
            // Validate columns 
            const visibleColumns = columnEdits.filter(col => !col.isRemoved);
            
            // Validate we have at least one column
            if (visibleColumns.length === 0) {
                alert('You must have at least one column.');
                return;
            }
            
            // Check for empty names
            let hasEmptyName = false;
            visibleColumns.forEach(column => {
                if (!column.name || column.name.trim() === '') {
                    hasEmptyName = true;
                    // Find the input element and highlight it
                    const input = column.element.querySelector('.column-name-input');
                    if (input) {
                        input.classList.add('error');
                        input.focus();
                    }
                }
            });
            
            if (hasEmptyName) {
                alert('Column names cannot be empty.');
                return;
            }
            
            // Create new column config based on DOM order
            const columnItems = Array.from(columnList.querySelectorAll('.column-item:not(.removing)'));
            const newColumnsConfig = columnItems.map(item => {
                const id = item.dataset.id;
                const input = item.querySelector('.column-name-input');
                const name = input?.value.trim() || 'Unnamed Column';
                
                return { id, name };
            });
            
            if (newColumnsConfig.length > 0) {
                // Save new configuration
                updateColumnsConfiguration(newColumnsConfig);
                
                // Close modal
                modalOverlay.remove();
                document.removeEventListener('keydown', handleKeyDown);
            } else {
                alert('Error creating column configuration');
            }
        });
        
        modal.appendChild(saveButton);
        
        // Add modal to the overlay
        modalOverlay.appendChild(modal);
        
        // Add keyboard event listener for ESC key
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                modalOverlay.remove();
                document.removeEventListener('keydown', handleKeyDown);
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        
        // Add click event to close when clicking outside the modal
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) {
                modalOverlay.remove();
                document.removeEventListener('keydown', handleKeyDown);
            }
        });
        
        // Add overlay to the DOM
        document.querySelector('main').appendChild(modalOverlay);
    } catch (error) {
        console.error('Error opening kanban settings:', error);
    }
}

/**
 * Update the columns configuration
 * @param {Array} newConfig - New column configuration
 */
function updateColumnsConfiguration(newConfig) {
    try {
        // Validate input
        if (!Array.isArray(newConfig) || newConfig.length === 0) {
            console.error('Invalid column configuration');
            return;
        }
        
        // Update COLUMNS_CONFIG with new values
        COLUMNS_CONFIG.length = 0;
        newConfig.forEach(col => {
            if (col && typeof col === 'object' && col.id && typeof col.name === 'string') {
                COLUMNS_CONFIG.push(col);
            }
        });
        
        // Update derived COLUMNS array
        const newColumns = COLUMNS_CONFIG.map(column => column.id);
        COLUMNS.length = 0;
        newColumns.forEach(col => COLUMNS.push(col));
        
        // Handle removed columns - move tasks to the first available column
        const firstColumnId = COLUMNS_CONFIG[0]?.id;
        if (!firstColumnId) {
            console.error('No valid columns in new configuration');
            return;
        }
        
        // Get all keys from tasks object
        const existingColumns = Object.keys(tasks);
        
        // Find columns that no longer exist
        existingColumns.forEach(columnId => {
            if (!COLUMNS.includes(columnId) && tasks[columnId] && tasks[columnId].length > 0) {
                // Create target column if it doesn't exist
                if (!tasks[firstColumnId]) {
                    tasks[firstColumnId] = [];
                }
                
                // Move tasks to the first column
                if (Array.isArray(tasks[columnId])) {
                    tasks[columnId].forEach(task => {
                        if (task && typeof task === 'object') {
                            tasks[firstColumnId].push({
                                ...task,
                                column: firstColumnId
                            });
                        }
                    });
                }
                
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
        
        // Save tasks and column configuration in parallel
        Promise.all([
            saveTasks(),
            saveColumnsConfig()
        ]).then(() => {
            // Rebuild the board
            setupKanbanBoard();
            renderTasks();
        }).catch(error => {
            console.error('Error saving column configuration:', error);
        });
    } catch (error) {
        console.error('Error updating column configuration:', error);
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', initApp);

// Add CSS custom properties to control spacing and responsiveness
const root = document.documentElement;
root.style.setProperty('--archive-header-spacing', '12px');

// Set basic responsive rules based on width
const setResponsiveLayout = () => {
    const width = window.innerWidth;
    if (width <= 400) {
        root.style.setProperty('--archive-header-layout', 'column');
        root.style.setProperty('--archive-actions-layout', 'space-between');
    } else {
        root.style.setProperty('--archive-header-layout', 'row wrap');
        root.style.setProperty('--archive-actions-layout', 'flex-end');
    }
};

// Set initial layout
setResponsiveLayout();

// Update on resize
window.addEventListener('resize', setResponsiveLayout);
